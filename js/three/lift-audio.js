// ЖК VILNYI (Ужгород) — soft music in the lift car (V10-lift).
// A calm Ukrainian station played as its own live internet stream, quietly, while the visitor is inside a lift car.
// It reuses the car radio of the driving mode (radio.js: one <audio> element, HTTPS streams only, a dead stream is
// skipped silently, after one full round it gives up and stays quiet — no error, no generated tone).
// start() MUST be called inside the tap that calls / enters the lift (browsers only let sound start from a gesture);
// stop() fades it out (≈ 1.2 s) and drops the stream. The mute choice of the visitor is remembered (localStorage).
// The car radio's own settings (station, volume, off) are not touched: this is a second, independent player.
import { createRadio, STATIONS } from './radio.js';

// The calm stations first. Stream addresses are radio.js's, checked on 2026-10-08 (notes/V6-cars.md), plus the
// spare Lounge FM address of the same check. Edit the order here; addresses live in radio.js.
const CALM = ['relax', 'melodia', 'lux', 'jazz'];
export const LIFT_STATIONS = [
  ...CALM.map(id => STATIONS.find(s => s.id === id)).filter(Boolean),
  { id: 'lounge', name: 'Lounge FM', freq: 'FM', url: 'https://cast.mediaonline.net.ua/loungefm320', codec: 'mp3', home: 'https://loungefm.com.ua/' },
];
export const LIFT_VOLUME = 0.16;                  // background level (the car radio starts at 0.45)
const LS_MUTE = 'vrc.lift.music.muted';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** → { start(), stop(fadeMs), toggleMute(), get muted, get playing, get status, get el, onChange(cb), dispose() }
 *  opts: stations, volume, audio (factory for tests), connectMs. Nothing here throws. */
export function createLiftMusic({ stations = LIFT_STATIONS, volume = LIFT_VOLUME, audio = null, connectMs = 8000 } = {}) {
  let R = null, fadeTok = 0, muted = lsGet(LS_MUTE) === '1', inside = false;
  const subs = new Set();
  const emit = () => { for (const cb of subs) { try { cb(api); } catch { /* a listener's problem */ } } };
  const radio = () => {
    if (R) return R;
    try { R = createRadio({ stations, volume, audio, connectMs, remember: false }); R.onChange(emit); } catch { R = null; }
    return R;
  };
  const fade = (from, to, ms, then) => {
    const tok = ++fadeTok, t0 = performance.now();
    const step = () => {
      if (tok !== fadeTok || !R) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      try { R.setDuck(from + (to - from) * k); } catch { /* */ }
      if (k < 1) setTimeout(step, 40); else if (then) then();
    };
    step();
  };
  let primeT = 0;
  const api = {
    /** a landing call (still outside the car): open the stream silently inside that tap, so it may sound once the
     *  visitor steps in (iOS lets an element play later only if a gesture started it); dropped after 45 s unused */
    prime() {
      if (inside || muted) return;
      const r = radio(); if (!r) return;
      if (!r.state.on || r.state.status === 'error') { try { r.setDuck(0); r.setMuted(false); r.start(true); } catch { return; } }
      clearTimeout(primeT); primeT = setTimeout(() => { if (!inside) api.stop(300); }, 45000);
    },
    /** the visitor is in the car (call inside the tap): play softly, fading in; a muted player only remembers it */
    start() {
      inside = true;
      const r = radio(); if (!r) return false;
      if (muted) { emit(); return false; }
      if (r.state.on && r.state.status !== 'error') { fade(r.state.duck ?? 1, 1, 600); return true; }
      try { r.setDuck(0); r.setMuted(false); r.start(true); } catch { return false; }
      fade(0, 1, 1500);
      return true;
    },
    /** the visitor stepped out: fade out, then drop the stream */
    stop(ms = 1200) {
      inside = false;
      if (!R || !R.state.on) { emit(); return; }
      fade(R.state.duck ?? 1, 0, ms, () => { try { R.stop(false); } catch { /* */ } emit(); });
    },
    toggleMute() {
      muted = !muted; lsSet(LS_MUTE, muted ? '1' : '0');
      if (muted) { if (R && R.state.on) fade(R.state.duck ?? 1, 0, 300, () => { try { R.stop(false); } catch { /* */ } emit(); }); }
      else if (inside) api.start();
      emit();
      return muted;
    },
    get muted() { return muted; },
    get inside() { return inside; },
    get playing() { return !!(R && R.state.on && R.state.status === 'playing'); },
    get status() { return R ? R.state.status : 'off'; },
    get station() { return R && R.state.on ? R.state.station : null; },
    get el() { return R ? R.el : null; },
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    dispose() { fadeTok++; clearTimeout(primeT); subs.clear(); if (R) { try { R.dispose(); } catch { /* */ } } R = null; },
  };
  return api;
}
