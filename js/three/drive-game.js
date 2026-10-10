// ЖК VILNYI (Ужгород) — the driving GAME layer of the walkthrough (V9 integration; mixed into Walkthrough like drive.js).
// The drive mode is a separate experience from the buyer's path: it starts only when the visitor chooses to get into a car,
// the first time with a short notice (game mode with traffic, pedestrians and police · «Вийти»). V18 (v0.6, owner): no
// «with / without blood» caption or switch anywhere in the UI; the game keeps its default (blood marks ON, fading).
// Then, once the city data (city-data.js) is loaded: people.js (fictional pedestrians, drivers, hits, decals) and police.js
// (wanted level, patrols, arrest) run around the driven car. Nothing of it exists in the hero, finder, unit sheet or the
// plain walkthrough. Content rules of people.js stay as they are: children and people with a pram can never be run over.
// Hooks used: drive.js (driveHooks, takeCar, stopCar, _exitCar, _trafficObstacles), walk.js (_goto, _isOutside, el, t).
import { createPeopleAudio } from './people-audio.js';
import { PROJECT } from '../data.js';

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));
const NOTICE_KEY = 'vrc.drive.notice', BLOOD_KEY = 'vrc.drive.blood';

const CSS = `
.vw-gnote .card p{margin:0 0 14px;font-size:14px;line-height:1.45;color:#e9e3d6}
.vw-gnote .row{display:flex;gap:10px}.vw-gnote .row .vw-btn{flex:1}
.vw-dosm{position:absolute;left:calc(8px + var(--sl));top:calc(10px + var(--st));font-size:10px;line-height:1.2;color:rgba(255,255,255,.78);text-shadow:0 1px 2px rgba(0,0,0,.8);text-decoration:none;direction:ltr;pointer-events:auto}
.vw.phone .vw-dosm{top:auto;bottom:calc(4px + var(--sb));left:50%;transform:translateX(-50%);font-size:9px;white-space:nowrap}
.vw .vrc-police-hud{position:absolute;z-index:3}
.vw .vrc-police-stars{top:calc(104px + var(--st));right:calc(10px + var(--sr))}
.vw[dir=rtl] .vrc-police-stars{right:auto;left:calc(10px + var(--sl))}
.vw.phone .vrc-police-stars{top:calc(150px + var(--st))}
.vw .vrc-police-stars span{font-size:18px}
.vw-gtake{position:absolute;left:50%;bottom:calc(150px + var(--sb));transform:translateX(-50%);z-index:2}
`;

export const gameMixin = {
  _gameEnabled() { const f = PROJECT && PROJECT.features; return !(f && f.driveGame === false) && !(this.opts && this.opts.game === false) && lsGet('vrc.drive.game') !== 'off'; },   // the last one: a switch for the car-only tests
  _gameSettings() { return this._gset || (this._gset = { blood: lsGet(BLOOD_KEY) !== 'off' }); },   // blood ON by default (owner's wish); V18: no switch in the UI any more (an older saved 'off' is still respected)
  _gameSetBlood(on) {
    const S = this._gameSettings(); S.blood = !!on; lsSet(BLOOD_KEY, on ? 'on' : 'off');
    const G = this._game; if (G && G.people) try { G.people.setBlood(!!on); } catch { /* */ }
    this._gameHud();
  },
  _gameCss() { if (this._gcss || !this.el) return; const s = document.createElement('style'); s.textContent = CSS; this.el.hud.appendChild(s); this._gcss = s; },
  // the audio of the people / police (WebAudio needs the user's tap: called from the same tap that starts the radio)
  _gameAudioResume() {
    if (!this._gameEnabled()) return;
    try { if (!this._gAudio) this._gAudio = createPeopleAudio(); this._gAudio.resume(); } catch (e) { console.warn('[game] audio', e); }
  },

  // ---- the one-time notice before the first drive. → true when it was shown (the caller stops; «Поїхали» continues)
  _gameNotice(cont) {
    if (!this._gameEnabled() || lsGet(NOTICE_KEY) === '1' || this._gNoticeSeen || !this.el) return false;
    this._gameCss();
    const t = k => this.t(k), d = document.createElement('div');
    d.className = 'vw-help vw-gnote show'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML = `<div class="card"><h3></h3><p></p><div class="row"><button class="vw-btn vw-ghost" data-g="exit"></button><button class="vw-btn vw-gold" data-g="go"></button></div></div>`;
    d.querySelector('h3').textContent = t('walk.game.title'); d.querySelector('p').textContent = t('walk.game.text');
    d.querySelector('[data-g=exit]').textContent = t('walk.game.exit'); d.querySelector('[data-g=go]').textContent = t('walk.game.go');
    for (const n of ['pointerdown', 'keydown', 'wheel']) d.addEventListener(n, ev => ev.stopPropagation());
    d.addEventListener('click', ev => {
      ev.stopPropagation();
      const b = ev.target.closest('[data-g]'); if (!b) return;
      d.remove(); this._gNote = null;
      if (b.dataset.g === 'go') { this._gNoticeSeen = true; lsSet(NOTICE_KEY, '1'); cont(); }   // still inside this tap: radio + audio start in cont
    });
    this.el.hud.appendChild(d); this._gNote = d;
    setTimeout(() => { try { d.querySelector('[data-g=go]').focus(); } catch { /* */ } }, 50);
    return true;
  },

  // ---- start the game once the city data is there (called on every drive:enter; idempotent)
  _gameStart() {
    if (!this._gameEnabled() || this.disposed) return null;
    if (this._gameP) return this._gameP;
    this._gameCss();
    this._gameP = (async () => {
      this._cityStart();
      await this._cityP;
      const CD = this._cityMod; if (!CD || !CD.CITY || !CD.CITY.ready) throw new Error('city data not loaded');
      const [PM, PO] = await Promise.all([import('./people.js'), import('./police.js')]);
      if (this.disposed) return null;
      const hooks = this.driveHooks(), settings = this._gameSettings(), cars = this.mods.cars;
      if (!this._gAudio) this._gAudio = createPeopleAudio();
      let SH = null; try { SH = (await import('./environment.js')).SHARED; } catch { /* */ }
      const lightMode = () => this.envMode || 'day';
      const people = PM.createPeople(this.scene, { city: CD, drive: hooks, settings, audio: this._gAudio, carSpec: k => cars.carSpec(k), lightMode,
        cityOptions: SH && SH.uTime ? { signalTime: () => SH.uTime.value } : undefined });
      const hud = document.createElement('div'); hud.className = 'vw-ghud'; this.el.hud.appendChild(hud);
      const phone = !!this._phone;
      const police = PO.createPolice(this.scene, { city: people.city, people, drive: hooks, lang: String(this.lang).slice(0, 2), lightMode, audio: this._gAudio, light: this._polLight || null,   // V11: the walkthrough's police light slot
        respawn: { x: 0, z: 0 }, hud,
        // a patrol car on one of the site's own car bodies (desktop); phones keep the light built-in body
        carFactory: phone || !cars.createCar ? undefined : () => { const m = cars.createCar('ev', 'white'), S = cars.carSpec('ev'); return { group: m.group, L: S.L, W: S.W, H: S.H, setDoor: k => m.setDoor && m.setDoor(k) }; } });
      const offs = [];
      // the drive's takeover event: a driver still in the seat is pulled out (people.js animates it)
      offs.push(hooks.on('take', ({ car }) => { try { if (car && people.canEject(car)) people.ejectDriver(car); } catch (e) { console.warn('[game] eject', e); } }));
      // arrest → fine sheet → back on foot at the complex
      police.on('police:respawn', () => { this._gameRespawn(); });
      people.on('people:hit', ev => { if (ev && ev.byPlayer && navigator.vibrate) try { navigator.vibrate(ev.severity === 'hard' ? 160 : 60); } catch { /* */ } });
      this._game = { people, police, hud, offs, errs: 0 };
      this._gameHud();
      return this._game;
    })().catch(e => { console.warn('[game] off for this visit:', e && e.message ? e.message : e); this._game = null; return null; });
    return this._gameP;
  },
  async _gameRespawn() {
    for (let i = 0; i < 60 && this.busy; i++) await sleep(100);
    if (this.drive) { try { this.drive.ctl.v = 0; } catch { /* */ } await this._exitCar(); }
    if (this.drive) return;
    try { await this._goto('outside'); } catch (e) { console.warn('[game] respawn', e); }
  },
  _gameStop() {
    const G = this._game; this._game = null; this._gameP = null; if (!G) return;
    for (const f of G.offs) try { f(); } catch { /* */ }
    try { G.police.dispose(); } catch { /* */ } try { G.people.dispose(); } catch { /* */ } try { G.hud.remove(); } catch { /* */ }
  },
  _gameDispose() { this._gameStop(); try { if (this._gAudio) this._gAudio.dispose(); } catch { /* */ } this._gAudio = null; },

  // ---- the drive HUD additions (V18: the blood on / off button is gone; the city's «© OpenStreetMap contributors» link is shown
  // by environment.js, bottom right of the 3D view, once the city is on)
  _gameHudInit() { if (!this.el || !this.el.drive || !this._gameEnabled()) return; this._gameCss(); this._gameHud(); },
  _gameHud() { /* nothing of its own in the drive bar any more */ },

  // ---- every frame, after the cars moved (walk.js _loop, after env.update)
  _gameTick(dt) {
    const G = this._game; if (!G) return;
    // on in the car and on foot outdoors at street level; asleep in the buildings and in the car park on foot (the tour)
    const P = this.player.pos, on = !!this.drive || (this._isOutside(P) && P.y > -0.6);
    if (G.people.group) G.people.group.visible = on;
    G.hud.style.display = on ? '' : 'none';
    if (on !== G.was) { G.was = on; if (!on) { try { G.police.clear(); } catch { /* */ } try { this._gAudio && this._gAudio.stopSirens && this._gAudio.stopSirens(); } catch { /* */ } if (this.el && this.el.gtake) this.el.gtake.style.display = 'none'; this._gTake = null; } this._gameHud(); }
    if (!on || !(dt > 0)) return;
    const ctx = { camera: this.camera, player: this.drive ? null : { onFoot: true, x: P.x, z: P.z } };
    try { G.people.update(dt, ctx); G.police.update(dt, ctx); G.errs = 0; }
    catch (e) { console.warn('[game]', e); if (++G.errs > 5) { console.warn('[game] switched off after repeated errors'); this._gameStop(); this._gameP = Promise.resolve(null); } return; }
    if (!this.drive) { this._trafficObstacles(); this._gameTakeWatch(); }
  },
  // obstacles the traffic brakes for: people on crossings / lying on the road (near the plot's streets, where the traffic runs)
  _gameRoadObstacles() {
    const G = this._game; if (!G) return [];
    const out = [];
    try { for (const o of G.people.roadObstacles()) if (Math.abs(o.x) < 260 && Math.abs(o.z) < 260) out.push({ x: o.x, z: o.z, kind: 'person' }); } catch { /* */ }
    return out;
  },
  // police cars (and their roadblocks) are solid for the visitor's car: → the unit hit or null
  _gamePoliceHit(quad, cx, cz) {
    const G = this._game; if (!G || !this.drive) return null;
    let list; try { list = G.police.colliders(); } catch { return null; }
    const Q = this.mods.cars.quadsOverlap;
    for (const u of list) {
      if (Math.abs(u.x - cx) > 9 || Math.abs(u.z - cz) > 9) continue;
      const c = Math.cos(u.yaw), s = Math.sin(u.yaw), hl = (u.L || 4.8) / 2, hw = (u.W || 1.9) / 2, W = (lx, lz) => [u.x + lx * c + lz * s, u.z - lx * s + lz * c];
      if (Q(quad, [W(hw, hl), W(-hw, hl), W(-hw, -hl), W(hw, -hl)])) return u;
    }
    return null;
  },

  // ---- on foot next to a car of the traffic: «Забрати це авто» → it stops, the driver is pulled out, the visitor drives it
  _gameTakeWatch() {
    const now = performance.now(); if (now - (this._gtT || 0) < 250) return; this._gtT = now;
    const e = this.el; if (!e || this.busy || this.riding || this.mode !== 'walk') return;
    let best = null, bd = 6.5;
    if (!this._chipRec) {
      const P = this.player.pos, fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      this.forEachTrafficCar(c => { const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz); if (d < bd && (d < 3.2 || (dx * fx + dz * fz) / (d || 1) > 0.5)) { bd = d; best = c; } });
    }
    if (best === this._gTake) return;
    this._gTake = best;
    if (!e.gtake) {
      const b = document.createElement('button'); b.className = 'vw-btn vw-gold vw-gtake'; b.dataset.kg = 'take';
      b.addEventListener('click', ev => { ev.stopPropagation(); if (this._gTake) this._gameTake(this._gTake); });
      b.addEventListener('pointerdown', ev => ev.stopPropagation());
      e.hud.appendChild(b); e.gtake = b;
    }
    e.gtake.textContent = this.t('walk.game.take');
    e.gtake.style.display = best ? 'inline-flex' : 'none';
  },
  async _gameTake(c) {
    if (!c || this.busy || this.drive || c.taken) return;
    if (this._gameNotice(() => this._gameTake(c))) return;
    // the tap: radio, car sound and the people's audio may start now
    this._radioStart(); this._carAudio(); this._gameAudioResume();
    if (this.el && this.el.gtake) this.el.gtake.style.display = 'none';
    this._gTake = null; this._gtT = performance.now() + 2500;
    const G = this._game, P = this.player.pos;
    try {
      this.stopCar(c, true);
      for (let t0 = performance.now(); (c.v || 0) > 0.3 && performance.now() - t0 < 4000;) await frame();
      let r = null; try { if (G && G.people.canEject(c)) r = G.people.ejectDriver(c, { x: P.x, z: P.z }); } catch (e) { console.warn('[game] eject', e); }
      if (r && r.done) await Promise.race([r.done, sleep(8000)]);   // ≈ 1.1 s at normal frame rates
      const rec = await this.takeCar(c);
      if (!rec) { this.stopCar(c, false); this._radioStop(); }
    } catch (e) { console.warn('[game] take', e); this._radioStop(); }
  },
};
