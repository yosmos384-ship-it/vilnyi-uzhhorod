// people-audio.js — every sound of the people / police code, synthesised with WebAudio (no audio files).
// createPeopleAudio({ context?, volume? }) → { resume(), setListener(x, z, yaw), thud, shout, scream, gasp, siren, log, dispose }
// Nothing plays (and nothing throws) until resume() succeeded after a user gesture; every call is recorded in `log` for the tests.
export function createPeopleAudio({ context = null, volume = 0.8 } = {}) {
  let ctx = context, master = null, noise = null, lx = 0, lz = 0, lyaw = 0, muted = false;
  const log = [], sirens = new Map();
  const ok = () => ctx && ctx.state === 'running' && !muted;
  function ensure() {
    if (!ctx) { const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) return false; try { ctx = new AC(); } catch (e) { return false; } }
    if (!master) { master = ctx.createGain(); master.gain.value = volume; const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
      const n = ctx.sampleRate, buf = ctx.createBuffer(1, n, n), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; noise = buf; }
    return true;
  }
  // distance gain and stereo position of a world point
  function place(x, z, ref = 6) {
    const dx = x - lx, dz = z - lz, d = Math.hypot(dx, dz), g = Math.min(1, ref / Math.max(ref, d)) * (d > 160 ? 0 : 1);
    const rx = -Math.cos(lyaw) * dx + Math.sin(lyaw) * dz;                      // + = to the listener's right
    return { g, pan: Math.max(-1, Math.min(1, rx / Math.max(4, d))) };
  }
  function out(x, z, ref) { const P = place(x, z, ref), g = ctx.createGain(); g.gain.value = P.g; let node = g; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = P.pan; g.connect(p); node = p; } node.connect(master); return g; }
  function rec(kind, x, z, extra) { log.push({ kind, x: +x.toFixed(1), z: +z.toFixed(1), t: ctx ? +ctx.currentTime.toFixed(2) : 0, played: ok(), ...extra }); if (log.length > 400) log.shift(); return ok(); }
  const A = {
    log,
    get running() { return ok(); },
    async resume() { if (!ensure()) return false; try { await ctx.resume(); } catch (e) {} return ok(); },
    setVolume(v) { volume = v; if (master) master.gain.value = v; }, mute(m) { muted = !!m; },
    setListener(x, z, yaw = 0) { lx = x; lz = z; lyaw = yaw; },
    /** Body hit by a car: a low thump plus a short burst of filtered noise. strength 0..1 */
    thud(x, z, strength = 0.6) {
      if (!rec('thud', x, z, { strength: +strength.toFixed(2) })) return;
      const t = ctx.currentTime, o = out(x, z, 9), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(140 - 50 * strength, t); osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * (0.4 + 0.6 * strength), t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.3);
      const ns = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g2 = ctx.createGain(); ns.buffer = noise; f.type = 'lowpass'; f.frequency.value = 700 + 1400 * strength;
      g2.gain.setValueAtTime(0.5 * strength + 0.12, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + 0.1 * strength); ns.connect(f); f.connect(g2); g2.connect(o); ns.start(t, Math.random() * 0.5, 0.3);
    },
    // a voice: sawtooth through two formant band-passes, pitch contour by kind
    _voice(x, z, f0, dur, contour, vowel = [800, 1250], gain = 0.5, ref = 10) {
      const t = ctx.currentTime, o = out(x, z, ref), osc = ctx.createOscillator(), g = ctx.createGain(); osc.type = 'sawtooth';
      contour.forEach(([u, k], i) => i ? osc.frequency.linearRampToValueAtTime(f0 * k, t + u * dur) : osc.frequency.setValueAtTime(f0 * k, t));
      const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 6 + Math.random() * 2; vg.gain.value = f0 * 0.02; vib.connect(vg); vg.connect(osc.frequency); vib.start(t); vib.stop(t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.04); g.gain.setValueAtTime(gain, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      for (const [i, fq] of vowel.entries()) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = 5; const bg = ctx.createGain(); bg.gain.value = i ? 0.6 : 1; osc.connect(bp); bp.connect(bg); bg.connect(g); }
      const ns = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain(); ns.buffer = noise; nf.type = 'bandpass'; nf.frequency.value = 2400; ng.gain.value = 0.05; ns.connect(nf); nf.connect(ng); ng.connect(g); ns.start(t, Math.random() * 0.5, dur);
      g.connect(o); osc.start(t); osc.stop(t + dur + 0.02);
    },
    /** An angry / warning shout ("hey!"). f0: the person's voice pitch in Hz. */
    shout(x, z, f0 = 140, kind = 'hey') {
      if (!rec('shout', x, z, { f0: Math.round(f0), voice: kind })) return;
      if (kind === 'hey') A._voice(x, z, f0 * 1.5, 0.42, [[0, 1.1], [0.25, 1.35], [1, 0.85]], [650, 1900], 0.5);
      else if (kind === 'cry') A._voice(x, z, f0 * 1.7, 0.7, [[0, 1.3], [0.3, 1.15], [1, 0.7]], [850, 1300], 0.5);
      else A._voice(x, z, f0 * 1.4, 0.9, [[0, 1], [0.2, 1.3], [0.5, 1.1], [0.7, 1.3], [1, 0.9]], [700, 1500], 0.42);
    },
    scream(x, z, f0 = 220) { if (!rec('scream', x, z, { f0: Math.round(f0) })) return; A._voice(x, z, Math.min(900, f0 * 2.6), 0.95, [[0, 0.8], [0.15, 1.25], [0.8, 1.15], [1, 0.75]], [1100, 2600], 0.55, 14); },
    /** A crowd gasp: a breathy rising noise plus a few short voices. n: how many people. */
    gasp(x, z, n = 4) {
      if (!rec('gasp', x, z, { n })) return;
      const t = ctx.currentTime, o = out(x, z, 12), ns = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); ns.buffer = noise; f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.35); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      ns.connect(f); f.connect(g); g.connect(o); ns.start(t, 0, 0.8);
      for (let i = 0; i < Math.min(5, n); i++) setTimeout(() => { if (ok()) A._voice(x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6, 150 + Math.random() * 160, 0.3 + Math.random() * 0.2, [[0, 1], [0.4, 1.4], [1, 1.2]], [750, 1400], 0.16, 12); }, 60 + i * 70 + Math.random() * 90);
    },
    /** Police siren (wail, or yelp when close). Returns a handle { move(x, z), stop() }; one per patrol car. */
    siren(id, x, z, mode = 'wail') {
      let h = sirens.get(id); if (h) { h.move(x, z); return h; }
      rec('siren', x, z, { id, mode });
      const live = ok(); let o = null, osc = null, lfo = null, g = null;
      if (live) { const t = ctx.currentTime; g = ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.16, t + 0.3); osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 900;
        lfo = ctx.createOscillator(); lfo.type = mode === 'yelp' ? 'sawtooth' : 'triangle'; lfo.frequency.value = mode === 'yelp' ? 3.2 : 0.28; const lg = ctx.createGain(); lg.gain.value = 320; lfo.connect(lg); lg.connect(osc.frequency);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8; o = out(x, z, 25); osc.connect(bp); bp.connect(g); g.connect(o); osc.start(t); lfo.start(t); }
      h = { id, mode, x, z, move(nx, nz) { h.x = nx; h.z = nz; if (o) { const P = place(nx, nz, 25); o.gain.setTargetAtTime(P.g, ctx.currentTime, 0.1); } },
        stop() { sirens.delete(id); if (g) { const t = ctx.currentTime; g.gain.setTargetAtTime(0.0001, t, 0.15); try { osc.stop(t + 0.8); lfo.stop(t + 0.8); } catch (e) {} } } };
      sirens.set(id, h); return h;
    },
    /** Loudspeaker of a patrol car: an attention tone and a short distorted "voice" burst (the words are shown as text by the HUD). */
    speaker(x, z) {
      if (!rec('speaker', x, z, {})) return;
      const t = ctx.currentTime, o = out(x, z, 22);
      for (const [i, f] of [[0, 880], [1, 660]]) { const osc = ctx.createOscillator(), g = ctx.createGain(); osc.type = 'square'; osc.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.14, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.15); osc.connect(g); g.connect(o); osc.start(t + i * 0.16); osc.stop(t + i * 0.16 + 0.17); }
      for (let k = 0; k < 7; k++) setTimeout(() => { if (!ok()) return; const t2 = ctx.currentTime, osc = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), sh = ctx.createWaveShaper(), c = new Float32Array(64); for (let i = 0; i < 64; i++) { const v = i / 32 - 1; c[i] = Math.tanh(v * 5); } sh.curve = c;
        osc.type = 'sawtooth'; const f0 = 120 + Math.random() * 40; osc.frequency.setValueAtTime(f0 * 1.1, t2); osc.frequency.linearRampToValueAtTime(f0 * 0.9, t2 + 0.2); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 900; bp.Q.value = 2.5; g.gain.setValueAtTime(0.0001, t2); g.gain.exponentialRampToValueAtTime(0.2, t2 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.2); osc.connect(bp); bp.connect(sh); sh.connect(g); g.connect(o); osc.start(t2); osc.stop(t2 + 0.22); }, 420 + k * 230);
    },
    stopSirens() { for (const h of [...sirens.values()]) h.stop(); },
    dispose() { A.stopSirens(); if (master) { try { master.disconnect(); } catch (e) {} } if (ctx && !context) { try { ctx.close(); } catch (e) {} } },
  };
  return A;
}
