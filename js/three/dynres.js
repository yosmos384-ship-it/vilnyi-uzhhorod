// js/three/dynres.js — adaptive resolution for the live 3D (V11 performance pass).
// The renderer's pixel ratio follows the measured frame time: when frames take longer than ~38 ms (under ≈ 26 fps) for a
// second, the ratio steps down (×0.85, never below `min`); when they stay under ~20 ms for three seconds it steps back up
// (never above `max`). Long stalls (> 250 ms: a build, a shader compile, a hidden tab) are not fill-rate and are ignored.
// Automated browsers (navigator.webdriver: the site's tests and picture tools) keep a fixed ratio so their pictures are
// stable; `?dynres=1` forces it on there, `?dynres=0` switches it off anywhere.
const Q = typeof location !== 'undefined' ? location.search : '';
const FORCE = /[?&]dynres=1\b/.test(Q), OFF = /[?&]dynres=0\b/.test(Q);
export const DYNRES_ON = !OFF && (FORCE || !(typeof navigator !== 'undefined' && navigator.webdriver));
export const isPhone = () => { try { return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820; } catch (e) { return false; } };

/** Pixel-ratio cap for this device: phones `phone`, others `desk` — and never above devicePixelRatio. */
export function ratioCap(desk = 1.75, phone = 1.5) {
  return Math.min(typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1, isPhone() ? phone : desk);
}

export function createDynRes(renderer, { max = ratioCap(), min = 0.75, start = max, onChange = null } = {}) {
  let ema = 16, slow = 0, fast = 0, cool = 0, last = 0, cur = Math.max(min, Math.min(max, start));
  renderer.setPixelRatio(cur);
  const set = pr => {
    pr = Math.max(min, Math.min(max, +pr.toFixed(3)));
    if (Math.abs(pr - renderer.getPixelRatio()) < 0.01) return;
    cur = pr; renderer.setPixelRatio(pr);    // three re-sizes the drawing buffer with the same CSS size
    try { onChange && onChange(pr); } catch (e) { /* the caller's hook must not stop the loop */ }
  };
  return {
    get ratio() { return cur; },
    get max() { return max; },
    /** call once per drawn frame with the rAF timestamp */
    frame(now) {
      if (!DYNRES_ON) return;
      const dt = last ? now - last : 16; last = now;
      if (dt > 250 || dt <= 0) { slow = fast = 0; return; }
      ema += (dt - ema) * 0.1;
      if (cool > 0) { cool -= dt; return; }
      if (ema > 38) { slow += dt; fast = 0; if (slow > 1000 && cur > min) { set(cur * 0.85); slow = 0; cool = 1200; ema = 30; } }
      else if (ema < 20) { fast += dt; slow = 0; if (fast > 3000 && cur < max) { set(cur * 1.1); fast = 0; cool = 2000; } }
      else { slow = Math.max(0, slow - dt); fast = 0; }
    },
    /** a new cap (e.g. after a resize / a mode with its own budget); the ratio is clamped into it */
    setMax(m) { max = m; if (cur > max) set(max); },
    reset() { last = 0; slow = fast = 0; },
  };
}
