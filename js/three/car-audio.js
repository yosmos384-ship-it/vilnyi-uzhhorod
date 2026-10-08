// ЖК VILNYI (Ужгород) — the sounds of the driving mode. Everything here is generated in the browser (WebAudio): no audio
// files. The radio (real stations, live streams through an <audio> element) is radio.js; it is re-exported here so that a
// host needs one import: `import { createCarAudio, createRadio, STATIONS } from './car-audio.js'`.
//
//   const A = createCarAudio(audioContext, { muted });
//   A.engineStart(spec)                       spec = carSpec(kind): perf.eng 'v12' | 'v10' | 'v8' | 'i4' | 'ev', the horn class
//   A.update({ rpm, redline, throttle, v (m/s), gearNo, squeal 0…1, slip 0…1, under (car park), disabled, damage 0…1, scrape 0…1 })
//   A.engineStop()
//   A.horn(true | false, spec)                each class has its own horn
//   A.impact(speed m/s, { glass, metal })     thud + crunch (+ broken glass)
//   A.tick(on)                                indicator relay: tick / tock
//   A.door()                                  door shut
//   A.alarm(seconds, gain)                    the alarm of a parked car that was hit
//   A.startFail()                             the starter of a dead engine
//   A.setMuted(b)  ·  A.state                 { engine, horn, alarm, muted } for the HUD and the tests
// Nothing throws: without an AudioContext every call is a no-op.
export { createRadio, STATIONS } from './radio.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const CYL = { v12: 12, v10: 10, v8: 8, i4: 4, ev: 0 };
// timbre per engine family: [saw at firing/2, square at firing, sine at crank order, rumble noise, low-pass base Hz, low-pass per rpm, drive, level]
const VOICE = {
  v12: { a: 0.42, b: 0.2, c: 0.16, n: 0.1, lp: 300, lpk: 0.3, dr: 1.6, lvl: 0.05, det: 1.004 },
  v10: { a: 0.5, b: 0.3, c: 0.08, n: 0.12, lp: 340, lpk: 0.42, dr: 2.4, lvl: 0.055, det: 1.007 },
  v8: { a: 0.5, b: 0.34, c: 0.3, n: 0.2, lp: 240, lpk: 0.24, dr: 2.2, lvl: 0.06, det: 0.994 },
  i4: { a: 0.45, b: 0.22, c: 0.12, n: 0.1, lp: 280, lpk: 0.3, dr: 1.5, lvl: 0.04, det: 1.003 },
};
// horn per class: [frequencies], wave, low-pass, level
const HORNS = {
  lux: { f: [404, 508], w: 'sawtooth', lp: 2400, g: 0.1 },      // two-tone fanfare of a big saloon / SUV
  sport: { f: [440, 554, 660], w: 'sawtooth', lp: 3400, g: 0.085 },
  truck: { f: [311, 392], w: 'square', lp: 1700, g: 0.09 },     // the off-roader: lower
  small: { f: [494], w: 'square', lp: 2200, g: 0.07 },          // the city car: one note
  ev: { f: [420, 525], w: 'triangle', lp: 3000, g: 0.14 },
};
export function hornClass(spec) {
  const k = spec && spec.kind, e = spec && spec.perf && spec.perf.eng;
  return e === 'ev' ? 'ev' : k === 'super' || k === 'gt' || k === 'cabrio' ? 'sport' : k === 'offroad' ? 'truck' : k === 'city' ? 'small' : 'lux';
}

export function createCarAudio(ac, { muted = false } = {}) {
  const state = { engine: false, horn: false, alarm: false, muted: !!muted, kind: null, hornClass: null, shifts: 0, impacts: 0, ticks: 0 };
  const noop = () => {};
  if (!ac) return { ac: null, out: null, state, engineStart: noop, update: noop, engineStop: noop, horn: noop, impact: noop, tick: noop, door: noop, alarm: noop, alarmStop: noop, startFail: noop, shift: noop, setMuted(b) { state.muted = !!b; }, stopAll: noop, dispose: noop };
  const out = ac.createGain(); out.gain.value = muted ? 0 : 1;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  out.connect(comp).connect(ac.destination);
  const nlen = ac.sampleRate * 2, noise = ac.createBuffer(1, nlen, ac.sampleRate);
  { const d = noise.getChannelData(0); let b = 0; for (let i = 0; i < nlen; i++) { const w = Math.random() * 2 - 1; b = b * 0.6 + w * 0.4; d[i] = w * 0.6 + b * 0.8; } }
  const shaper = k => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } const w = ac.createWaveShaper(); w.curve = c; return w; };
  const nsrc = (type, f, q, dest) => { const s = ac.createBufferSource(); s.buffer = noise; s.loop = true; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ac.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(dest || out); s.start(ac.currentTime, Math.random() * 1.5); return { s, fl, g }; };
  const safe = fn => (...a) => { try { return fn(...a); } catch (e) { if (!state.err) { state.err = String(e); console.warn('[car-audio]', e); } return undefined; } };
  let E = null, H = null, AL = null, lastGear = 0;

  function engineStart(spec) {
    if (E) engineStop();
    const eng = (spec && spec.perf && spec.perf.eng) || 'v8', ev = eng === 'ev', t = ac.currentTime;
    const bus = ac.createGain(); bus.gain.value = 0; bus.connect(out);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = ev ? 0.4 : 1.1; lp.frequency.value = ev ? 3200 : 420;
    const tyres = { road: nsrc('bandpass', 360, 0.6), wind: nsrc('lowpass', 650, 0.4), sq: nsrc('bandpass', 1850, 9), sq2: nsrc('bandpass', 2450, 12), scr: nsrc('bandpass', 2900, 1.2) };
    if (ev) {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), o3 = ac.createOscillator(), g1 = ac.createGain(), g2 = ac.createGain(), g3 = ac.createGain();
      o1.type = 'sine'; o2.type = 'triangle'; o3.type = 'sine'; g1.gain.value = 0.5; g2.gain.value = 0.16; g3.gain.value = 0.2;
      o1.connect(g1).connect(lp); o2.connect(g2).connect(lp); o3.connect(g3).connect(lp); lp.connect(bus);
      for (const o of [o1, o2, o3]) o.start(t);
      E = { ev, eng, bus, lp, os: [o1, o2, o3], tyres, cyl: 0, V: null };
    } else {
      const V = VOICE[eng] || VOICE.v8, cyl = CYL[eng] || 8;
      const sh = shaper(V.dr), pre = ac.createGain(); pre.gain.value = 0.6; pre.connect(sh).connect(lp).connect(bus);
      const mk = (type, g) => { const o = ac.createOscillator(), gn = ac.createGain(); o.type = type; gn.gain.value = g; o.connect(gn).connect(pre); o.start(t); return o; };
      const oa = mk('sawtooth', V.a), ob = mk('square', V.b), oc = mk('sine', V.c), od = mk('sawtooth', V.a * 0.5);
      // exhaust rumble: noise whose loudness pulses at the firing frequency
      const rum = nsrc('lowpass', 220, 0.7, pre), am = ac.createGain(); am.gain.value = 0; const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.connect(am).connect(rum.g.gain); lfo.start(t);
      rum.g.gain.value = V.n;
      am.gain.value = V.n * 0.8;
      // the starter: half a second of cranking, then the idle
      for (const o of [oa, ob, oc, od]) { o.frequency.setValueAtTime(14, t); }
      E = { ev, eng, bus, lp, os: [oa, ob, oc, od, lfo], oa, ob, oc, od, lfo, rum, tyres, cyl, V, born: t };
    }
    bus.gain.setTargetAtTime(ev ? 0.012 : E.V.lvl * 0.7, t + (ev ? 0 : 0.25), 0.2);
    state.engine = true; state.kind = eng; lastGear = 0;
  }
  function update(s) {
    if (!E) return;
    const t = ac.currentTime, v = Math.abs(s.v || 0), kmh = v * 3.6, thr = clamp(s.throttle || 0), dmg = clamp(s.damage || 0), under = !!s.under;
    if (E.ev) {
      const f = 190 + kmh * 9.5;
      E.os[0].frequency.setTargetAtTime(f, t, 0.05); E.os[1].frequency.setTargetAtTime(f * 2.02, t, 0.05); E.os[2].frequency.setTargetAtTime(f * 0.5, t, 0.05);
      E.bus.gain.setTargetAtTime(s.disabled ? 0 : kmh < 0.5 && !thr ? 0.002 : 0.008 + Math.min(0.02, kmh * 0.00012) + thr * 0.02, t, 0.08);
    } else {
      const V = E.V, red = s.redline || 7000, rough = dmg > 0.45 ? 1 + (Math.sin(t * 31) * 0.5 + Math.sin(t * 13.7) * 0.5) * 0.09 * dmg : 1;   // a hurt engine runs unevenly
      const rpm = (s.disabled ? 0 : Math.max(650, s.rpm || 800)) * rough, crank = rpm / 60, fire = crank * E.cyl / 2;
      const tc = t - E.born < 0.5 ? 0.12 : 0.035;
      E.oa.frequency.setTargetAtTime(fire / 2, t, tc); E.ob.frequency.setTargetAtTime(fire, t, tc); E.oc.frequency.setTargetAtTime(crank * (E.cyl === 8 ? 1 : 2), t, tc); E.od.frequency.setTargetAtTime(fire / 2 * V.det, t, tc);
      E.lfo.frequency.setTargetAtTime(Math.max(4, fire / 2), t, tc);
      E.lp.frequency.setTargetAtTime(V.lp + rpm * V.lpk * (0.45 + 0.55 * thr) + thr * 450, t, 0.06);
      const load = 0.55 + 0.45 * thr, revs = clamp(rpm / red);
      E.bus.gain.setTargetAtTime(s.disabled ? 0 : V.lvl * (0.55 + 0.75 * revs) * load * (under ? 1.25 : 1), t, 0.07);
      if (s.gearNo && lastGear && s.gearNo !== lastGear && !s.disabled) shift(s.gearNo > lastGear);
      lastGear = s.gearNo || lastGear;
    }
    const T = E.tyres, sq = clamp(s.squeal || 0);
    T.road.g.gain.setTargetAtTime(Math.min(0.06, kmh * 0.0007), t, 0.2); T.road.fl.frequency.setTargetAtTime(300 + kmh * 2.2, t, 0.3);
    T.wind.g.gain.setTargetAtTime(Math.min(0.2, (v / 83) ** 2 * 0.2), t, 0.25); T.wind.fl.frequency.setTargetAtTime(480 + v * 16, t, 0.3);
    T.sq.g.gain.setTargetAtTime(sq * (under ? 0.085 : 0.05), t, sq > 0.05 ? 0.04 : 0.12); T.sq.fl.frequency.setTargetAtTime(1500 + Math.min(900, v * 20), t, 0.1);
    T.sq2.g.gain.setTargetAtTime(sq * clamp(s.slip || 0) * 0.05, t, 0.06);
    T.scr.g.gain.setTargetAtTime(clamp(s.scrape || 0) * 0.12, t, 0.03);
  }
  // a gear change: the drive is cut for a moment (and a soft clunk); the rev drop itself comes from the rev counter
  function shift(up = true) {
    if (!E || E.ev) return; state.shifts++;
    const t = ac.currentTime, g = E.bus.gain, cur = g.value;
    g.cancelScheduledValues(t); g.setValueAtTime(cur, t); g.linearRampToValueAtTime(cur * 0.35, t + 0.04); g.linearRampToValueAtTime(cur, t + 0.16);
    const o = ac.createOscillator(), og = ac.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(up ? 150 : 110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.07);
    og.gain.setValueAtTime(0.05, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); o.connect(og).connect(out); o.start(t); o.stop(t + 0.1);
  }
  function engineStop() {
    const e = E; if (!e) return; E = null; state.engine = false;
    const t = ac.currentTime; e.bus.gain.cancelScheduledValues(t); e.bus.gain.setTargetAtTime(0, t, 0.1);
    for (const n of Object.values(e.tyres)) { n.g.gain.setTargetAtTime(0, t, 0.08); n.s.stop(t + 0.7); }
    for (const o of e.os) o.stop(t + 0.7); if (e.rum) e.rum.s.stop(t + 0.7);
  }
  function horn(on, spec) {
    if (on) {
      if (H) return; const cls = hornClass(spec), D = HORNS[cls], t = ac.currentTime;
      const g = ac.createGain(); g.gain.value = 0; g.connect(out);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = D.lp; lp.Q.value = 1.2; lp.connect(g);
      const os = D.f.flatMap(f => [f, f * 1.006]).map(f => { const o = ac.createOscillator(); o.type = D.w; o.frequency.value = f; o.connect(lp); o.start(t); return o; });
      g.gain.setTargetAtTime(D.g, t, 0.012);
      H = { g, os }; state.horn = true; state.hornClass = cls;
    } else { const h = H; if (!h) return; H = null; state.horn = false; const t = ac.currentTime; h.g.gain.setTargetAtTime(0, t, 0.025); for (const o of h.os) o.stop(t + 0.25); }
  }
  const burst = (type, f, q, gain, dur, when = 0, dest = out) => { const t = ac.currentTime + when, s = ac.createBufferSource(); s.buffer = noise; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(fl).connect(g).connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05); };
  const ping = (f, gain, dur, when = 0) => { const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02); };
  // a contact: a dull thud always; from ≈ 20 km/h the crunch of sheet metal; glass when something breaks
  function impact(speed = 1, { glass = false, metal = true, gain = 1 } = {}) {
    state.impacts++;
    const k = clamp(speed / 14) * gain, t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(95 + speed * 2, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.2);
    g.gain.setValueAtTime(0.12 + 0.3 * k, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g).connect(out); o.start(t); o.stop(t + 0.35);
    if (speed > 2.5) burst('lowpass', 500 + speed * 40, 0.6, 0.1 + 0.3 * k, 0.12 + 0.2 * k);
    if (metal && speed > 5) { burst('bandpass', 1100, 0.7, Math.min(0.4, speed * 0.015) * gain, 0.3 + 0.5 * k); burst('bandpass', 2600, 2.5, Math.min(0.2, speed * 0.008) * gain, 0.2 + 0.4 * k, 0.03); for (let i = 0; i < 3; i++) ping(180 + Math.random() * 500, 0.04 * k, 0.25, 0.02 + Math.random() * 0.12); }
    if (glass) { burst('highpass', 4200, 0.8, 0.22 * gain, 0.5); for (let i = 0; i < 9; i++) ping(2600 + Math.random() * 5200, 0.02 + Math.random() * 0.03, 0.08 + Math.random() * 0.2, 0.03 + Math.random() * 0.5); }
  }
  let tickPh = false;
  function tick(on = null) { tickPh = on == null ? !tickPh : !!on; state.ticks++; burst('bandpass', tickPh ? 2300 : 1700, 6, 0.06, 0.03); ping(tickPh ? 1150 : 860, 0.012, 0.03); }
  function door() { burst('lowpass', 240, 0.8, 0.3, 0.14); ping(72, 0.2, 0.16); burst('bandpass', 1800, 2, 0.03, 0.05, 0.01); }
  function startFail() { for (let i = 0; i < 5; i++) { burst('bandpass', 330, 2.5, 0.09, 0.09, i * 0.13); ping(48, 0.07, 0.09, i * 0.13); } }
  // the alarm of a parked car: a two-tone wail for `secs` seconds (gain: how far away it is)
  function alarm(secs = 6, gain = 1) {
    alarmStop();
    const t = ac.currentTime, g = ac.createGain(); g.gain.value = 0; g.connect(out);
    const lp = ac.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 1500; lp.Q.value = 0.9; lp.connect(g);
    const o = ac.createOscillator(); o.type = 'square'; o.connect(lp);
    for (let i = 0; i * 0.36 < secs; i++) { o.frequency.setValueAtTime(i % 2 ? 980 : 1320, t + i * 0.36); }
    g.gain.setTargetAtTime(0.05 * clamp(gain, 0.05, 1), t, 0.02); g.gain.setTargetAtTime(0, t + secs, 0.05);
    o.start(t); o.stop(t + secs + 0.3);
    AL = { g, o, until: t + secs }; state.alarm = true;
    o.onended = () => { if (AL && AL.o === o) { AL = null; state.alarm = false; } };
  }
  function alarmStop() { const a = AL; if (!a) return; AL = null; state.alarm = false; try { a.g.gain.setTargetAtTime(0, ac.currentTime, 0.03); a.o.stop(ac.currentTime + 0.2); } catch { /* already over */ } }
  const api = {
    ac, out, state, noise,
    engineStart: safe(engineStart), update: safe(update), engineStop: safe(engineStop), shift: safe(shift), horn: safe(horn), impact: safe(impact), tick: safe(tick), door: safe(door),
    alarm: safe(alarm), alarmStop: safe(alarmStop), startFail: safe(startFail),
    setMuted: safe(b => { state.muted = !!b; out.gain.setTargetAtTime(b ? 0 : 1, ac.currentTime, 0.05); }),
    stopAll: safe(() => { engineStop(); horn(false); alarmStop(); }),
    dispose: safe(() => { engineStop(); horn(false); alarmStop(); try { out.disconnect(); comp.disconnect(); } catch { /* */ } }),
  };
  return api;
}
