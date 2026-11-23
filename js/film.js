// v0.15.1 — the GT film v2 on the home page (section #film, right after the hero).
// • lazy: nothing is downloaded until the section comes within 300 px of the viewport (IntersectionObserver);
// • autoplay muted + loop + playsinline, paused while off screen; a sound button (unmutes; the film then pauses when
//   scrolled away); tap on the picture = play / pause;
// • phones in portrait (≤ 600 px wide) get the 1080x1920 vertical cut, everything else the 16:9 cut;
// • end card by site language: en → English, he → Hebrew, uk / ro / de / fr / it → Ukrainian;
//   16:9: Ukrainian end card in 1080p (WebM VP9 if the browser plays it, else H.264) on screens ≥ 1100 device px wide,
//   720p H.264 otherwise and for en / he; vertical: uk 1080x1920, en / he 720x1280;
// • prefers-reduced-motion or Save-Data: no autoplay — poster + play button;
// • the GT button opens the same GT drive mode as the hero's «GT VILNYI» button (shown only when that button is offered).
import { t, onLangChange, applyDom, lang, initialLang } from './i18n.js';
import './i18n-film.js';

const BASE = 'assets/film/';
const WA = '380675279818';
const PORTRAIT = '(orientation: portrait) and (max-width: 600px)';

function init() {
  const sec = document.getElementById('film');
  if (!sec) return;
  const video = sec.querySelector('video'), frame = sec.querySelector('.film-frame');
  const playB = sec.querySelector('.film-play'), soundB = sec.querySelector('.film-sound');
  const gtB = sec.querySelector('.film-gt'), waA = sec.querySelector('.film-wa');
  const mqP = matchMedia(PORTRAIT), mqR = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const noAuto = () => mqR.matches || saveData;
  const webm = !!video.canPlayType && video.canPlayType('video/webm; codecs="vp9, opus"') === 'probably';
  let near = false, visible = false, userPaused = false, key = '', booted = false;
  // this module runs before app.js sets the page language: until then use the language app.js will pick (initialLang)
  const curLang = () => (booted ? lang : initialLang());

  const endLang = () => { const l = curLang(); return l === 'en' ? 'en' : l === 'he' ? 'he' : 'uk'; };
  function pick() {
    const l = endLang();
    if (mqP.matches) return { key: 'v-' + l, src: BASE + (l === 'uk' ? 'film-v2-vert1080-uk.mp4' : `film-v2-vert720-${l}.mp4`), poster: BASE + 'poster-9x16.webp', vertical: true };
    const big = l === 'uk' && Math.max(innerWidth, innerHeight) * (devicePixelRatio || 1) >= 1100 && !saveData;
    const src = big ? BASE + (webm ? 'film-v2-1080-uk.webm' : 'film-v2-1080-uk.mp4') : BASE + `film-v2-720-${l}.mp4`;
    return { key: 'h-' + l + (big ? '-1080' : '-720'), src, poster: BASE + 'poster-16x9.webp', vertical: false };
  }
  function setUi() {
    const playing = !video.paused && !video.ended && video.currentSrc;
    playB.hidden = !!playing;
    playB.setAttribute('aria-label', t('film.play'));
    frame.classList.toggle('is-playing', !!playing);
    const on = !video.muted;
    soundB.setAttribute('aria-pressed', String(on));
    soundB.setAttribute('aria-label', t(on ? 'film.soundOff' : 'film.soundOn'));
    soundB.title = soundB.getAttribute('aria-label');
    soundB.classList.toggle('on', on);
  }
  function load(force) {
    const v = pick();
    sec.classList.toggle('film-vertical', v.vertical);
    video.poster = v.poster;
    if (!near && !force) return;
    if (v.key === key) return;
    const tm = key ? video.currentTime : 0, wasPlaying = key && !video.paused;
    key = v.key; video.src = v.src; video.preload = noAuto() && !force ? 'metadata' : 'auto';
    if (tm) video.addEventListener('loadedmetadata', () => { try { video.currentTime = tm; } catch (e) { /* not seekable yet */ } }, { once: true });
    if (wasPlaying || (!noAuto() && visible && !userPaused)) play();
  }
  function play() {
    if (!key) load(true);
    const p = video.play();
    if (p && p.catch) p.catch(() => setUi());       // autoplay refused (e.g. low-power mode) → poster + play button
  }
  video.addEventListener('play', setUi); video.addEventListener('pause', setUi); video.addEventListener('volumechange', setUi);
  video.addEventListener('playing', setUi);
  // a WebM that fails to load or decode → the H.264 file of the same cut
  video.addEventListener('error', () => {
    const s = video.currentSrc || video.src || '';
    if (/\.webm$/.test(s)) { const tm = video.currentTime; video.src = s.replace(/\.webm$/, '.mp4'); if (tm) video.currentTime = tm; if (!noAuto() && visible && !userPaused) play(); }
  });

  playB.addEventListener('click', () => { userPaused = false; play(); });
  video.addEventListener('click', () => { if (video.paused) { userPaused = false; play(); } else { userPaused = true; video.pause(); } });
  soundB.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted) { userPaused = false; if (video.paused) play(); }
    setUi();
  });

  // lazy: start observing only after the page's own load (the hero picture first), then fetch within 150 px of view
  const observe = () => {
    new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting && !near) { near = true; load(); }
    }), { rootMargin: '150px 0px' }).observe(frame);
    new IntersectionObserver(es => es.forEach(e => {
      visible = e.isIntersecting;
      if (visible) { if (key && !noAuto() && !userPaused && video.paused && video.muted) play(); }
      else if (!video.paused) { video.pause(); if (!video.muted) video.muted = true; }
    }), { threshold: 0.25 }).observe(frame);
  };
  if (!('IntersectionObserver' in window)) { near = true; load(); }
  else if (document.readyState === 'complete') observe();
  else addEventListener('load', observe, { once: true });

  const re = () => load();
  mqP.addEventListener ? mqP.addEventListener('change', re) : mqP.addListener(re);

  // GT drive mode: reuse the hero's button (app.js decides whether the game is offered: WebGL, features.drive)
  const heroGt = document.getElementById('heroGt');
  const syncGt = () => { gtB.hidden = !heroGt || heroGt.hidden; };
  if (heroGt) new MutationObserver(syncGt).observe(heroGt, { attributes: true, attributeFilter: ['hidden'] });
  syncGt();
  gtB.addEventListener('click', () => { if (heroGt && !heroGt.hidden) { video.pause(); heroGt.click(); } });

  const lang2 = (l) => {
    if (l) booted = true;
    applyDom(sec);
    waA.href = `https://wa.me/${WA}?text=${encodeURIComponent(t('wa.greeting'))}`;
    load(); setUi();
  };
  onLangChange(lang2); lang2();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
