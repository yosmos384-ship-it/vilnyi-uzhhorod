// Hero slideshow: slide 1 is the developer's night render (with slow Ken Burns and a few twinkling lights sampled
// from its own lit windows), then the daytime renders from assets/hero-slides.json, then the "3D" slide.
// V4: the 3D slide shows a path-traced still of the complex first (assets/hero3d/<view>-<day|dusk|night>.webp, cameras in
// assets/hero3d/views.json; made by pano-work/hero/) — sharp and instant on every device. The day / dusk / night control
// swaps the stills. The live model (js/hero3d.js, same camera) loads behind the still and takes over only when the
// visitor drags or taps; without WebGL, with Save-Data or on a failed build the stills simply stay.
// Auto-advances with cross-fades, pauses on hover / touch / when off screen, swipe on phones, dots with captions,
// and a "↺ Main image" button (and the logo) that returns to slide 1 at any time.
import { t, pick, onLangChange, dir } from './i18n.js';
import './i18n-hero.js';

const $ = (s, r = document) => r.querySelector(s);
const stage = $('#heroStage');
if (stage) init();

function init() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const track = $('#hsTrack'), dotsEl = $('#hsDots'), cap = $('#hsCap'), home = $('#hsHome'), play = $('#hsPlay');
  const slide3d = $('#heroHost');
  const DUR = 7000, DUR_FIRST = 9000, DUR_3D = 16000, FADE = 1400;

  const slides = [
    { el: $('.hs-real', track), kind: 'real', cap: () => t('hs.cap.real') },
    { el: slide3d, kind: '3d', cap: () => t(stills.ok && !liveOk() ? 'hs.cap.still' : 'hs.cap.3d') },
  ];
  const liveOk = () => st3d() === 'ready';
  // The "cover" box of slide 1 takes the picture's real proportions from the file itself (the CSS value is only the
  // first guess), so a replaced render is never stretched and the lights canvas stays aligned with it.
  const realImg = $('.hs-img', slides[0].el);
  const fitAr = () => {
    if (!realImg?.naturalWidth || !realImg.naturalHeight) return;
    const ar = realImg.naturalWidth / realImg.naturalHeight, css = parseFloat(getComputedStyle(slides[0].el).getPropertyValue('--ar'));
    if (!(Math.abs(css / ar - 1) < 0.01)) slides[0].el.style.setProperty('--ar', ar.toFixed(4));   // srcset rounding alone is < 1 %
  };
  if (realImg) { if (realImg.complete) fitAr(); realImg.addEventListener('load', fitAr); }
  // The blurred poster behind the loading 3D is the night render (small file, already used by phones as slide 1).
  // Set here, when the 3D slide is next in line, so the stylesheet needs no project-specific image path.
  const POSTER = 'assets/hero-real-night-1280.jpg';
  function poster() {
    stills.load();
    const p = $('.hs-3d-poster', slide3d);
    if (p && !p.dataset.set) { p.dataset.set = '1'; p.style.backgroundImage = `url("${POSTER}")`; p.style.backgroundPosition = '60% 55%'; }
  }
  let cur = 0, timer = 0, t0 = 0, remaining = DUR_FIRST, userPaused = reduced;
  const holds = new Set();
  const isRtl = () => (document.documentElement.dir || dir) === 'rtl';

  // ---------- slides from the manifest (lazy: only slide 1 is in the page and preloaded) ----------
  fetch('assets/hero-slides.json').then(r => (r.ok ? r.json() : null)).then(j => {
    const list = (j?.slides || []).filter(s => s && s.src);
    list.forEach((s, k) => {
      const fig = document.createElement('figure');
      fig.className = 'hs-slide hs-photo' + (k % 2 ? ' kb-b' : '');
      fig.dataset.kind = 'photo';
      if (s.pos) fig.style.setProperty('--op', s.pos);
      if (s.posMobile) fig.style.setProperty('--opm', s.posMobile);
      const img = document.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.dataset.src = s.src;
      fig.appendChild(img);
      track.insertBefore(fig, slide3d);
      const at = slides.findIndex(x => x.kind === '3d');   // before the 3D slide, or last when the 3D was dropped
      const item = { el: fig, img, kind: 'photo', cap: () => pick(s.caption) };
      slides.splice(at < 0 ? slides.length : at, 0, item);
      img.addEventListener('error', () => dropSlide(item), { once: true });   // a missing file never shows as a black slide
    });
    renderDots(); texts();
    if (cur === 0) prefetch(1);
  }).catch(() => {});

  function prefetch(i) {
    const s = slides[i];
    if (s?.img && !s.img.src) s.img.src = s.img.dataset.src;
    if (s?.kind === '3d') poster();
  }
  function dropSlide(item) {
    const i = slides.indexOf(item); if (i < 0) return;
    const wasOn = cur === i;
    slides.splice(i, 1); item.el.remove();
    if (cur > i) cur--;
    renderDots();
    if (wasOn) { cur = Math.min(cur, slides.length - 1); go(i % slides.length, { user: false, force: true }); } else texts();
  }
  function ready(s) {
    if (!s.img) return Promise.resolve();
    prefetch(slides.indexOf(s));
    if (s.img.complete && s.img.naturalWidth) return Promise.resolve();
    return new Promise(res => { const d = () => res(); s.img.addEventListener('load', d, { once: true }); s.img.addEventListener('error', d, { once: true }); setTimeout(d, 2500); });
  }

  // ---------- path-traced stills of the 3D slide ----------
  const stills = createStills(slide3d, stage, () => { if (fail3d && !stills.ok) drop3d(); else texts(); });

  // ---------- 3D availability ----------
  const st3d = () => window.__vrcHero3D;   // 'created' | 'ready' | 'failed' | undefined (never created, e.g. Save-Data)
  let fail3d = false;
  function drop3d() {
    fail3d = true;
    // V4: no WebGL / Save-Data / failed build → the slide stays, as path-traced stills (dropped only if those are missing too)
    if (stills.ok || stills.pending) { stage.classList.remove('live'); texts(); return; }
    const i = slides.findIndex(s => s.kind === '3d'); if (i < 0) return;
    const wasOn = cur === i;
    slides.splice(i, 1); slide3d.hidden = true;
    renderDots();
    if (wasOn) go(0); else texts();
  }
  document.addEventListener('vrc:hero3d-state', e => {
    if (e.detail === 'failed') drop3d();
    if (e.detail === 'ready') { stage.classList.add('live'); if (holds.delete('3dload') && slides[cur]?.kind === '3d') restart(); }
  });
  if (st3d() === 'failed') drop3d();
  if (st3d() === 'ready') stage.classList.add('live');
  let saveData = false; try { saveData = !!navigator.connection?.saveData; } catch (e) { /* ignore */ }
  if (saveData || !window.WebGLRenderingContext) drop3d();

  // ---------- navigation ----------
  let busy = 0, loadT = 0;
  async function go(i, { user = false, force = false } = {}) {
    const n = slides.length;
    i = ((i % n) + n) % n;
    if (!force && i === cur && slides[cur].el.classList.contains('is-on')) { if (user) restart(); return; }
    const token = ++busy;
    const next = slides[i];
    stopTimer();
    if (user) cap.setAttribute('aria-live', 'polite');
    if (next.kind === '3d') poster();
    if (next.kind === '3d' && !st3d() && !stills.ok && !stills.pending) { setTimeout(() => { if (!st3d()) drop3d(); }, 6000); }
    await ready(next);
    if (token !== busy) return;
    if (!slides.includes(next)) return go(i, { user });       // it was dropped while loading (missing file): take the one now in its place
    i = slides.indexOf(next);
    const prev = slides[cur];
    if (prev && prev !== next) {
      prev.el.classList.remove('is-on'); prev.el.classList.add('is-leaving');
      setTimeout(() => { if (!prev.el.classList.contains('is-on')) prev.el.classList.remove('is-leaving'); }, FADE + 60);
    }
    cur = i;
    next.el.classList.remove('is-leaving');
    void next.el.offsetWidth;   // restart the Ken Burns
    next.el.classList.add('is-on');
    document.dispatchEvent(new CustomEvent('vrc:hero3d', { detail: { active: next.kind === '3d' } }));
    stage.classList.toggle('at-home', cur === 0);
    stage.classList.toggle('on-3d', next.kind === '3d');
    if (cur === 0) lights.run(true); else setTimeout(() => lights.run(cur === 0), FADE + 60);
    holds.delete('3d');
    // The 3D slide's time starts when the model is on screen, not while it is still being built (slow phones): the
    // autoplay waits for 'ready' (at most 25 s), otherwise the slide could end before it was ever seen.
    holds.delete('3dload'); clearTimeout(loadT);
    if (next.kind === '3d' && st3d() !== 'ready' && !stills.ok) { holds.add('3dload'); loadT = setTimeout(() => hold('3dload', false), 25000); }
    if (next.kind === '3d') stills.show(); else stills.hide();
    prefetch(cur + 1);
    texts(true);
    restart();
  }
  const step = k => go(cur + k, { user: true });

  // ---------- autoplay (holds: hover, touch, offscreen, hidden tab, 3D interaction) ----------
  function durOf(i) { return slides[i]?.kind === '3d' ? DUR_3D : i === 0 ? DUR_FIRST : DUR; }
  function restart() {
    remaining = durOf(cur);
    stage.style.setProperty('--dur', remaining + 'ms');
    stage.classList.remove('is-auto'); void stage.offsetWidth;
    stage.classList.toggle('is-auto', !userPaused);
    startTimer();
  }
  function startTimer() {
    clearTimeout(timer); timer = 0;
    const held = userPaused || holds.size > 0;
    stage.classList.toggle('is-held', held);
    if (held) return;
    t0 = performance.now();
    timer = setTimeout(() => go(cur + 1), Math.max(300, remaining));
  }
  function stopTimer() { if (timer) { clearTimeout(timer); timer = 0; remaining -= performance.now() - t0; } }
  function hold(r, on) {
    if (on === holds.has(r)) return;
    if (on) { stopTimer(); holds.add(r); stage.classList.add('is-held'); } else { holds.delete(r); startTimer(); }
  }
  function setPaused(p) {
    userPaused = p; play.setAttribute('aria-pressed', String(p)); texts();
    if (p) { stopTimer(); stage.classList.add('is-held'); stage.classList.remove('is-auto'); } else restart();
  }

  stage.addEventListener('mouseenter', () => hold('hover', true));
  stage.addEventListener('mouseleave', () => hold('hover', false));
  let touchT = 0;
  stage.addEventListener('touchstart', () => { clearTimeout(touchT); hold('touch', true); }, { passive: true });
  const touchEnd = () => { clearTimeout(touchT); touchT = setTimeout(() => hold('touch', false), 4000); };
  stage.addEventListener('touchend', touchEnd, { passive: true });
  stage.addEventListener('touchcancel', touchEnd, { passive: true });
  new IntersectionObserver(es => { const e = es[es.length - 1]; hold('offscreen', !(e.isIntersecting && e.intersectionRatio >= 0.3)); lights.visible(e.isIntersecting); }, { threshold: [0, 0.3, 0.6] }).observe(stage);
  document.addEventListener('visibilitychange', () => hold('hidden', document.hidden));

  // ---------- swipe (phones) and keyboard ----------
  let sw = null;
  track.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const on3d = slides[cur]?.kind === '3d';
    if (on3d && !e.target.closest('.hs-ui, .mode')) slide3d.dataset.want = Date.now();   // pulled at the still before the model was ready: hero3d.js hands over as soon as it is
    if (on3d && (liveOk() || !stills.ok)) { hold('3d', true); return; }   // dragging the 3D orbits it; the user is exploring, so stop the autoplay
    sw = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  track.addEventListener('pointerup', e => {
    if (!sw || sw.id !== e.pointerId) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) step((dx < 0 ? 1 : -1) * (isRtl() ? -1 : 1));
  });
  track.addEventListener('pointercancel', () => { sw = null; });
  stage.addEventListener('keydown', e => {
    if (e.target.closest('.mode')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step((e.key === 'ArrowRight' ? 1 : -1) * (isRtl() ? -1 : 1)); }
    else if (e.key === 'Home') { e.preventDefault(); go(0, { user: true }); }
  });
  $('#hsPrev').addEventListener('click', () => step(-1));
  $('#hsNext').addEventListener('click', () => step(1));
  home.addEventListener('click', () => go(0, { user: true }));
  play.addEventListener('click', () => setPaused(!userPaused));
  $('.brand')?.addEventListener('click', () => go(0, { user: true }));
  dotsEl.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) go(+b.dataset.i, { user: true }); });

  // ---------- dots + texts ----------
  function renderDots() {
    dotsEl.innerHTML = slides.map((s, i) => `<button type="button" class="hs-dot${s.kind === '3d' ? ' d3' : ''}" data-i="${i}"><i></i>${s.kind === '3d' ? '<b dir="ltr">3D</b>' : ''}</button>`).join('');
  }
  function texts(swap) {
    const n = slides.length;
    dotsEl.setAttribute('aria-label', t('hs.region'));
    dotsEl.querySelectorAll('.hs-dot').forEach((b, i) => {
      b.setAttribute('aria-current', String(i === cur));
      const s = slides[i];
      b.setAttribute('aria-label', t('hs.slide', { n: i + 1, total: n }) + (s.kind === '3d' ? ' — ' + t('hs.live3d') : ''));
      b.title = s.kind === '3d' ? t('hs.live3d') : '';
    });
    stage.setAttribute('aria-label', t('hs.region'));
    $('.hs-home-t', home).textContent = t('hs.main');
    home.setAttribute('aria-label', t('hs.mainAria'));
    home.title = t('hs.mainAria');
    play.setAttribute('aria-label', t(userPaused ? 'hs.play' : 'hs.pause'));
    $('#hsPrev').setAttribute('aria-label', t('hs.prev'));
    $('#hsNext').setAttribute('aria-label', t('hs.next'));
    $('.hs-3d-lt', slide3d).textContent = t('hs.loading3d');
    const text = slides[cur]?.cap() || '';
    if (swap && cap.textContent !== text) {
      cap.classList.add('swap');
      setTimeout(() => { cap.textContent = slides[cur]?.cap() || ''; cap.classList.remove('swap'); }, 350);
    } else cap.textContent = text;
  }
  onLangChange(() => texts());
  document.addEventListener('vrc:hero3d-state', () => texts());

  // ---------- lights: gentle twinkles at the render's own brightest warm points ----------
  const lights = createLights($('.hs-real .hs-cover', track), $('.hs-real .hs-img', track), reduced);

  renderDots(); texts();
  stage.classList.add('at-home');
  play.setAttribute('aria-pressed', String(userPaused));
  lights.run(true);
  if (userPaused) { stage.classList.add('is-held'); } else restart();
}

const LIGHTS_BAND = [0.14, 0.885];   // night render of ЖК VILNYI: roofs start at ≈ 0.13, the road reflections at ≈ 0.89
// Illuminated signs of this render (roof sign, the three shop signs, the entrance sign): bright and warm like a window,
// but a sign that pulses reads as a fault. [x0, y0, x1, y1] in fractions of the picture.
const LIGHTS_SKIP = [[0.535, 0.32, 0.59, 0.405], [0.22, 0.58, 0.33, 0.66], [0.45, 0.635, 0.515, 0.7], [0.605, 0.665, 0.68, 0.725], [0.685, 0.785, 0.745, 0.825]];

function createLights(box, img, reduced) {
  const cv = box?.querySelector('.hs-lights');
  const api = { run() {}, visible() {} };
  if (!cv || !img || reduced) { if (cv) cv.hidden = true; return api; }
  const ctx = cv.getContext('2d');
  let pts = null, raf = 0, on = true, vis = true, W = 0, H = 0, dpr = 1, sprite = null;

  function sample() {
    try {
      const sw = 360, sh = Math.round(sw * img.naturalHeight / img.naturalWidth);
      const c = document.createElement('canvas'); c.width = sw; c.height = sh;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, sw, sh);
      const d = g.getImageData(0, 0, sw, sh).data;
      const L = new Float32Array(sw * sh);
      for (let i = 0, p = 0; i < L.length; i++, p += 4) L[i] = 0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2];
      const cand = [];
      // Only the band that holds the buildings: the sky above (stars are not ours to animate) and the wet road below
      // (a twinkle on a reflection reads as a glitch) are left alone. Fractions of the picture height.
      const y0 = Math.round(sh * LIGHTS_BAND[0]), y1 = Math.min(sh - 2, Math.round(sh * LIGHTS_BAND[1]));
      for (let y = y0; y < y1; y++) for (let x = 2; x < sw - 2; x++) {
        const i = y * sw + x, l = L[i], p = i * 4;
        if (l < 150 || d[p] < d[p + 2] + 30) continue;           // bright and warm (window / street lights)
        let max = true;
        for (let yy = -2; yy <= 2 && max; yy++) for (let xx = -2; xx <= 2; xx++) if ((xx || yy) && L[i + yy * sw + xx] > l) { max = false; break; }
        if (!max) continue;
        const fx = (x + 0.5) / sw, fy = (y + 0.5) / sh;
        if (LIGHTS_SKIP.some(r => fx >= r[0] && fx <= r[2] && fy >= r[1] && fy <= r[3])) continue;
        cand.push({ x: fx, y: fy, l });
      }
      cand.sort((a, b) => b.l - a.l);
      const out = [], min2 = Math.pow(7 / sw, 2), ar = sw / sh;
      const cap = matchMedia('(max-width: 700px)').matches ? 60 : 95;
      for (const c of cand) {
        if (out.length >= cap) break;
        if (out.some(o => Math.pow(o.x - c.x, 2) + Math.pow((o.y - c.y) / ar, 2) < min2)) continue;
        out.push(c);
      }
      const lmax = out[0]?.l || 255, lmin = out[out.length - 1]?.l || 150;
      pts = out.map((c, k) => ({
        x: c.x, y: c.y,
        s: 0.55 + 0.45 * (c.l - lmin) / Math.max(1, lmax - lmin),
        ph: Math.random() * Math.PI * 2,
        per: 2.8 + Math.random() * 5.5,
        star: k < 10,
      }));
    } catch (e) { pts = []; }
  }
  function makeSprite() {
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,246,220,1)');
    gr.addColorStop(0.12, 'rgba(255,214,140,.85)');
    gr.addColorStop(0.4, 'rgba(255,170,70,.22)');
    gr.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return s;
  }
  function size() {
    const r = box.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = box.offsetWidth; H = box.offsetHeight;   // untransformed size (Ken Burns scales the whole box, canvas included)
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    void r;
  }
  function frame(now) {
    raf = 0;
    if (!on || !vis || document.hidden || !pts) return;
    const tt = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const unit = W / 1000;
    for (const p of pts) {
      const w = Math.sin(p.ph + tt * (Math.PI * 2) / p.per);
      const a = Math.pow(Math.max(0, w), 5) * p.s;   // mostly dark, brief soft swells
      if (a < 0.02) continue;
      const r = (4 + 6 * p.s) * unit * (0.8 + 0.4 * a);     // about one window of this render
      ctx.globalAlpha = Math.min(0.85, a);
      ctx.drawImage(sprite, p.x * W - r, p.y * H - r, r * 2, r * 2);
      if (p.star && a > 0.35) {   // a hairline glint on the brightest few
        const k = (a - 0.35) * 0.6, len = r * 2.6;
        ctx.globalAlpha = k;
        ctx.fillStyle = 'rgba(255,230,180,1)';
        ctx.fillRect(p.x * W - len, p.y * H - 0.35 * unit, len * 2, 0.7 * unit);
        ctx.fillRect(p.x * W - 0.35 * unit, p.y * H - len * 0.7, 0.7 * unit, len * 1.4);
      }
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && on && vis && pts) raf = requestAnimationFrame(frame); }
  function start() {
    sprite = makeSprite(); sample(); size();
    new ResizeObserver(() => { size(); }).observe(box);
    document.addEventListener('visibilitychange', kick);
    kick();
  }
  if (img.complete && img.naturalWidth) setTimeout(start, 400);
  else img.addEventListener('load', () => setTimeout(start, 400), { once: true });
  api.run = r => { on = r; if (!r && raf) { cancelAnimationFrame(raf); raf = 0; } kick(); };
  api.visible = v => { vis = v; kick(); };
  return api;
}

// The stills of the "3D" slide. One <img> per light mode, stacked; only the current mode is fetched (the others on the
// first switch to them). Landscape or portrait picture by the slide's own aspect. The current light mode is read from the
// page's day / dusk / night control (#modeCtl, owned by app.js): its pressed button, else the saved choice, else dusk.
function createStills(host, stage, onChange) {
  const api = { ok: false, pending: true, load() {}, show() {}, hide() {}, mode: 'dusk' };
  if (!host) { api.pending = false; return api; }
  const MODES = ['day', 'dusk', 'night'];
  const modeCtl = document.getElementById('modeCtl');
  const box = document.createElement('div'); box.className = 'hs-stills'; box.setAttribute('aria-hidden', 'true');
  host.insertBefore(box, host.querySelector('.hero3d-slot') || null);
  let V = null, view = null, viewKey = '', wanted = false, shown = false;
  const imgs = {};
  const readMode = () => {
    const b = modeCtl?.querySelector('button[aria-pressed="true"]');
    let m = b?.dataset.mode; if (!MODES.includes(m)) { try { m = localStorage.getItem('vrc.time'); } catch (e) { m = null; } }
    return MODES.includes(m) ? m : 'dusk';
  };
  const signal = () => { try { document.dispatchEvent(new CustomEvent('vrc:hero3d-stills', { detail: { ok: api.ok, mode: api.mode } })); } catch (e) { /* ignore */ } };
  function pickView() {
    const r = host.getBoundingClientRect(); if (!r.width || !r.height) return V.views.land;
    return V.views.port && r.width / r.height < (V.portraitBelow || 0.95) ? V.views.port : V.views.land;
  }
  function build() {
    const v = pickView(), key = v === V.views.port ? 'port' : 'land';
    if (key === viewKey) return; viewKey = key; view = v;
    box.textContent = '';
    for (const m of MODES) {
      const im = document.createElement('img'); im.alt = ''; im.decoding = 'async'; im.draggable = false; im.dataset.mode = m;
      if (v.w && v.h) { im.width = v.w; im.height = v.h; }
      const pos = v.pos || [0.5, 0.5]; im.style.objectPosition = `${pos[0] * 100}% ${pos[1] * 100}%`;
      im.addEventListener('load', () => { im.dataset.ok = '1'; apply(); });
      im.addEventListener('error', () => { im.dataset.ok = '0'; apply(); });
      box.appendChild(im); imgs[m] = im;
    }
    if (wanted) fetchMode(api.mode);
    apply();
  }
  function fetchMode(m) {
    const im = imgs[m], f = view?.files?.[m];
    if (!im || !f) { if (im) im.dataset.ok = '0'; return; }
    if (!im.getAttribute('src')) im.src = 'assets/hero3d/' + f;
  }
  // which still is on: the current mode's when it has loaded (until then the previous one stays), none when it failed
  function apply() {
    if (!V) return;
    const cur = imgs[api.mode], okNow = cur?.dataset.ok === '1';
    if (okNow) for (const m of MODES) imgs[m].classList.toggle('on', m === api.mode);
    else if (cur?.dataset.ok === '0') for (const m of MODES) imgs[m].classList.remove('on');
    const was = api.ok, any = MODES.some(m => imgs[m].classList.contains('on'));
    api.ok = any; api.pending = wanted ? (!any && cur?.dataset.ok !== '0') : !!(view?.files?.[api.mode]);
    host.classList.toggle('has-stills', any);
    stage.classList.toggle('stills', any);
    if (any && modeCtl && shown) modeCtl.hidden = false;        // the light switch works on the stills too (also without WebGL)
    if (was !== api.ok || !api.pending) onChange();
    signal();
  }
  function setMode(m) { if (m === api.mode && imgs[m]?.getAttribute('src')) return; api.mode = m; if (V && wanted) { fetchMode(m); apply(); } }
  fetch('assets/hero3d/views.json').then(r => (r.ok ? r.json() : null)).then(j => {
    if (!j?.views?.land?.files) { api.pending = false; onChange(); return; }
    V = j; api.mode = readMode(); build();
    new ResizeObserver(() => build()).observe(host);
  }).catch(() => { api.pending = false; onChange(); });
  if (modeCtl) new MutationObserver(() => setMode(readMode())).observe(modeCtl, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  api.load = () => { wanted = true; if (V) { api.mode = readMode(); fetchMode(api.mode); } };
  api.show = () => { shown = true; api.load(); if (api.ok && modeCtl) modeCtl.hidden = false; };
  api.hide = () => { shown = false; };
  return api;
}
