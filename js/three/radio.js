// ЖК VILNYI (Ужгород) — the car radio of the driving mode.
// Real Ukrainian FM stations, played as their own live internet streams through one <audio> element. Nothing is stored in
// the site: the element is pointed at the station's public stream address (HTTPS, MP3 / AAC) and the browser plays it.
// The radio starts when the visitor gets into a car — start() MUST be called inside that tap / key handler (browsers only
// let sound start from a user gesture). A stream that does not answer is skipped silently; without a network the radio
// simply stays quiet. Nothing here throws.
//
// TO CHANGE THE STATIONS: edit STATIONS below (name, frequency label, stream address). Addresses were checked on
// 2026-10-08 (HTTP 200, audio/mpeg or audio/aac). `freq` is the station's FM frequency in Kyiv, shown as a label only (source: streema.com/radios/Kiev, 2026-10-08; none was found for Радіо Байрактар).

export const STATIONS = [
  { id: 'hitfm', name: 'Хіт FM', freq: '96.4 FM', url: 'https://online.hitfm.ua/HitFM', codec: 'mp3', home: 'https://www.hitfm.ua/' },
  { id: 'kissfm', name: 'Kiss FM', freq: '106.5 FM', url: 'https://online.kissfm.ua/KissFM', codec: 'mp3', home: 'https://www.kissfm.ua/' },
  { id: 'roks', name: 'Radio ROKS', freq: '103.6 FM', url: 'https://online.radioroks.ua/RadioROKS', codec: 'mp3', home: 'https://www.radioroks.ua/' },
  { id: 'nashe', name: 'Наше Радіо', freq: '107.9 FM', url: 'https://online.nasheradio.ua/NasheRadio', codec: 'mp3', home: 'https://www.nasheradio.ua/' },
  { id: 'melodia', name: 'Мелодія FM', freq: '95.2 FM', url: 'https://online.melodiafm.ua/MelodiaFM', codec: 'mp3', home: 'https://www.melodiafm.ua/' },
  { id: 'relax', name: 'Радіо Relax', freq: '101.5 FM', url: 'https://online.radiorelax.ua/RadioRelax', codec: 'mp3', home: 'https://www.radiorelax.ua/' },
  { id: 'lux', name: 'Люкс ФМ · Українські хіти', freq: '103.1 FM', url: 'https://lux.radio.tvstitch.com/ukrayinski-hiti-sd', codec: 'aac', home: 'https://lux.fm/' },
  { id: 'avtoradio', name: 'Авторадіо', freq: '107.4 FM', url: 'https://cast.mediaonline.net.ua/avtoradio', codec: 'mp3', home: 'https://avtoradio.ua/' },
  { id: 'nrj', name: 'NRJ', freq: '92.8 FM', url: 'https://cast.mediaonline.net.ua/nrj320', codec: 'mp3', home: 'https://nrjradio.ua/' },
  { id: 'jazz', name: 'Radio Jazz', freq: '104.6 FM', url: 'https://online.radiojazz.ua/RadioJazz', codec: 'mp3', home: 'https://www.radiojazz.ua/' },
  { id: 'bayraktar', name: 'Радіо Байрактар', freq: 'FM', url: 'https://online.radiobayraktar.ua/RadioBayraktar', codec: 'mp3', home: 'https://www.radiobayraktar.ua/' },
];

const LS_STATION = 'vrc.radio.station', LS_VOLUME = 'vrc.radio.volume', LS_OFF = 'vrc.radio.off';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const clamp01 = v => Math.max(0, Math.min(1, +v || 0));

/** One radio. → { state, stations, start(), stop(), next(), prev(), tune(i), toggle(), setVolume(v), volumeBy(d), setMuted(b), onChange(cb), dispose(), el }
 *  state: { on, index, station, status: 'off' | 'connecting' | 'playing' | 'error', volume, muted, fails }
 *  opts: stations, volume (0…1, default 0.45), connectMs (give a stream this long to start, default 9000), audio (a factory for tests). */
// V11: every player falls silent while the tab is hidden (the walkthrough's render loop pauses too) and comes back on return
const LIVE = new Set();
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  for (const p of LIVE) { const el = p.el; if (!el) continue; try { el.muted = document.hidden ? true : p.state.muted; } catch { /* a mock */ } }
});
export function createRadio({ stations = STATIONS, volume = null, connectMs = 9000, audio = null, remember = true } = {}) {
  const list = (stations || []).filter(s => s && /^https:\/\//i.test(s.url || ''));          // HTTPS only (the site is served over HTTPS)
  const saved = remember ? lsGet(LS_STATION) : null, savedVol = remember ? parseFloat(lsGet(LS_VOLUME)) : NaN;
  const state = { on: false, index: Math.max(0, list.findIndex(s => s.id === saved)), station: null, status: 'off', volume: clamp01(volume != null ? volume : Number.isFinite(savedVol) ? savedVol : 0.45), muted: false, fails: 0, wantOff: remember && lsGet(LS_OFF) === '1' };
  state.station = list[state.index] || null;
  const subs = new Set();
  let el = null, timer = null, token = 0, disposed = false;
  const emit = () => { for (const cb of subs) { try { cb(state); } catch { /* a listener's problem */ } } };
  const set = (status) => { if (state.status !== status) { state.status = status; emit(); } };
  function ensure() {
    if (el || disposed) return el;
    try {
      el = audio ? audio() : (typeof Audio !== 'undefined' ? new Audio() : null);
      if (!el) return null;
      el.preload = 'none'; el.volume = state.volume; el.muted = state.muted;
      try { el.setAttribute('playsinline', ''); el.setAttribute('aria-hidden', 'true'); } catch { /* a mock */ }
      el.addEventListener('playing', () => { if (!state.on) return; state.fails = 0; clearTimeout(timer); set('playing'); });
      el.addEventListener('waiting', () => { if (state.on && state.status === 'playing') set('connecting'); });
      el.addEventListener('error', () => { if (state.on) skip(token); });
      el.addEventListener('ended', () => { if (state.on) skip(token); });                     // a live stream that ends has dropped
    } catch { el = null; }
    return el;
  }
  // the current stream failed: try the next one, quietly; after one full round give up until the visitor asks again
  function skip(tk) {
    if (tk !== token || !state.on || disposed) return;
    state.fails++;
    if (state.fails >= list.length) { clearTimeout(timer); try { el && el.pause(); } catch { /* */ } set('error'); return; }
    play((state.index + 1) % list.length, false);
  }
  function play(i, byUser) {
    if (disposed || !list.length) { set('error'); return false; }
    if (byUser) state.fails = 0;
    state.index = ((i % list.length) + list.length) % list.length; state.station = list[state.index]; state.on = true;
    const tk = ++token; clearTimeout(timer);
    const a = ensure(); if (!a) { set('error'); return false; }
    state.status = 'connecting'; emit();
    try {
      a.src = state.station.url; a.volume = state.volume * (state.duck ?? 1); a.muted = state.muted;
      const pr = a.play();                                                                   // inside the user's gesture when start() / next() come from a tap or a key
      if (pr && typeof pr.catch === 'function') pr.catch(() => { if (tk === token && state.on) timer = setTimeout(() => skip(tk), 900); });
    } catch { timer = setTimeout(() => skip(tk), 900); return false; }
    timer = setTimeout(() => { if (tk === token && state.on && state.status !== 'playing') skip(tk); }, connectMs);
    if (byUser && remember) { lsSet(LS_STATION, state.station.id); lsSet(LS_OFF, '0'); state.wantOff = false; }
    return true;
  }
  function stop(byUser = false) {
    token++; clearTimeout(timer); state.on = false;
    try { if (el) { el.pause(); el.removeAttribute('src'); el.load(); } } catch { /* nothing to stop */ }   // drops the connection to the stream
    if (byUser && remember) { lsSet(LS_OFF, '1'); state.wantOff = true; }
    set('off'); emit();
  }
  const api = {
    state, stations: list,
    get el() { return el; },
    /** Start with the last station (call inside the gesture that puts the visitor into the car). `force` ignores "the visitor switched it off last time". */
    start(force = false) { if (state.wantOff && !force) { emit(); return false; } return play(state.index, true); },
    stop,
    next() { return play(state.index + 1, true); },
    prev() { return play(state.index - 1, true); },
    tune(i) { return play(typeof i === 'string' ? Math.max(0, list.findIndex(s => s.id === i)) : i, true); },
    toggle() { if (state.on) { stop(true); return false; } return play(state.index, true); },
    setVolume(v) { state.volume = clamp01(v); try { if (el) el.volume = state.volume * (state.duck ?? 1); } catch { /* */ } if (remember) lsSet(LS_VOLUME, String(state.volume)); emit(); },
    volumeBy(d) { this.setVolume(state.volume + d); },
    /** lower the radio for a moment (under the horn): k = 0…1 of the set volume */
    setDuck(k) { state.duck = clamp01(k); try { if (el) el.volume = state.volume * state.duck; } catch { /* */ } },
    setMuted(b) { state.muted = !!b; try { if (el) el.muted = state.muted; } catch { /* */ } emit(); },
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    dispose() { disposed = true; LIVE.delete(api); stop(false); subs.clear(); el = null; },
  };
  LIVE.add(api);
  return api;
}
