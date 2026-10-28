// heli-audio.js — V26: helicopter sound, synthesised with WebAudio (no audio files): main-rotor blade slap (noise amplitude-
// modulated at the blade-passage rate + a low thump), twin-turbine whine (two detuned tones through a band-pass, rising
// with the start-up), tail-fan hum, and wind growing with airspeed. Inside the cockpit the headset muffles it (low-pass).
export function createHeliAudio() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return { resume() {}, update() {}, setMuted() {}, get muted() { return true; }, dispose() {}, ok: false };
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0;
  const cabin = ctx.createBiquadFilter(); cabin.type = 'lowpass'; cabin.frequency.value = 16000;
  master.connect(cabin); cabin.connect(ctx.destination);
  const noiseBuf = (() => { const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.6 + last * 3; } return b; })();
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
  // rotor: low-passed noise × pulse LFO
  const rN = noise(), rF = ctx.createBiquadFilter(); rF.type = 'lowpass'; rF.frequency.value = 420; rF.Q.value = 0.7;
  const rAM = ctx.createGain(); rAM.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 0.01;
  const lfoShape = ctx.createWaveShaper(); { const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 255 * 2 - 1; c[i] = Math.pow(Math.max(0, -x), 3) * 1.4; } lfoShape.curve = c; }
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 1;
  lfo.connect(lfoShape); lfoShape.connect(lfoGain); lfoGain.connect(rAM.gain); lfo.start();
  const rG = ctx.createGain(); rG.gain.value = 0;
  rN.connect(rF); rF.connect(rAM); rAM.connect(rG); rG.connect(master);
  const thump = ctx.createOscillator(); thump.type = 'sine'; thump.frequency.value = 40; const thG = ctx.createGain(); thG.gain.value = 0; const thAM = ctx.createGain(); thAM.gain.value = 0;
  lfoGain.connect(thAM.gain); thump.connect(thAM); thAM.connect(thG); thG.connect(master); thump.start();
  // turbines
  const tF = ctx.createBiquadFilter(); tF.type = 'bandpass'; tF.frequency.value = 3800; tF.Q.value = 6;
  const tG = ctx.createGain(); tG.gain.value = 0; tF.connect(tG); tG.connect(master);
  const t1 = ctx.createOscillator(); t1.type = 'sawtooth'; const t2 = ctx.createOscillator(); t2.type = 'triangle'; const t3 = ctx.createOscillator(); t3.type = 'sine';
  const t3G = ctx.createGain(); t3G.gain.value = 0; t3.connect(t3G); t3G.connect(master);
  t1.connect(tF); t2.connect(tF); t1.start(); t2.start(); t3.start();
  const tN = noise(), tNF = ctx.createBiquadFilter(); tNF.type = 'bandpass'; tNF.frequency.value = 2200; tNF.Q.value = 1.2; const tNG = ctx.createGain(); tNG.gain.value = 0; tN.connect(tNF); tNF.connect(tNG); tNG.connect(master);
  // wind
  const wN = noise(), wF = ctx.createBiquadFilter(); wF.type = 'bandpass'; wF.frequency.value = 700; wF.Q.value = 0.6; const wG = ctx.createGain(); wG.gain.value = 0; wN.connect(wF); wF.connect(wG); wG.connect(master);
  let muted = false, vol = 0.8, turbine = 0;
  try { muted = localStorage.getItem('vrc-heli-mute') === '1'; } catch (e) { /* storage off */ }
  const set = (p, v, tc = 0.08) => p.setTargetAtTime(v, ctx.currentTime, tc);
  return {
    ok: true, ctx,
    resume() { if (ctx.state !== 'running') ctx.resume().catch(() => {}); },
    /** rpm 0..1 (rotor), spool 0..1 (turbines, lead the rotor at start-up), speed m/s, cockpit bool, dist = camera distance (m) */
    update({ rpm = 0, spool = rpm, speed = 0, cockpit = false, dist = 12, collective = 0 }) {
      turbine = spool;
      const near = Math.max(0.15, Math.min(1, 25 / Math.max(6, dist)));
      set(master.gain, muted ? 0 : vol * near, 0.15);
      set(cabin.frequency, cockpit ? 1400 : 16000, 0.2);
      const bpf = 3.2 + rpm * 15.5;                                  // blade passage (slapped, ≈ 18.7 Hz at 100 %)
      set(lfo.frequency, bpf, 0.3); set(thump.frequency, 32 + rpm * 22, 0.3);
      set(rG.gain, Math.min(1, rpm * 1.3) * (0.55 + collective * 0.35), 0.2); set(thG.gain, rpm * 0.35, 0.2); set(rF.frequency, 260 + rpm * 380 + collective * 200, 0.2);
      set(t1.frequency, 380 + turbine * 3200, 0.4); set(t2.frequency, 395 + turbine * 3260, 0.4); set(t3.frequency, 900 + turbine * 5200, 0.4);
      set(tF.frequency, 900 + turbine * 3400, 0.4); set(tG.gain, turbine > 0.01 ? 0.05 + turbine * 0.08 : 0, 0.3); set(t3G.gain, turbine * 0.012, 0.3);
      set(tNG.gain, turbine * 0.12, 0.3);
      set(wG.gain, Math.min(0.5, (speed / 70) ** 2 * 0.5), 0.3); set(wF.frequency, 500 + speed * 12, 0.3);
    },
    setMuted(m) { muted = !!m; try { localStorage.setItem('vrc-heli-mute', m ? '1' : '0'); } catch (e) { /* storage off */ } set(master.gain, muted ? 0 : vol, 0.05); },
    get muted() { return muted; },
    suspend() { if (ctx.state === 'running') ctx.suspend().catch(() => {}); },
    dispose() { try { master.disconnect(); ctx.close(); } catch (e) { /* closed */ } },
  };
}
