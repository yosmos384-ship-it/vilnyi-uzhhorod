// ЖК VILNYI (Ужгород) — driving in the walkthrough (the methods walk.js mixes into Walkthrough).
// Any parked car of the fleet can be entered (car park and streets): a prompt by the car, the driver's door swings, then
// the driver's seat or a chase camera. Physics: cars.js CarController. The way out: car-park aisles → either ramp (its
// barrier lifts) → the plot's driveway → the streets of the model (kerbs, buildings, trees, lamps and other traffic are
// solid; the traffic brakes for the visitor) → the edge of the model turns the car round. Back the same way.
// Inside: the live cockpit of car-models.js (instruments, radio screen, mirrors), the radio (radio.js — real stations, starts
// with the gesture that enters the car), engine / tyre / wind / horn sounds (WebAudio, generated), indicators, wipers.
// For the next wave (people, police, damage) the instance emits events and exposes a small API — see "hooks" below.
// `this` is the Walkthrough instance (walk.js): it provides the scene, the collision lists, the HUD and the audio context.
import * as THREE from 'three';
import * as DATA from '../data.js';
import { createRadio } from './radio.js';
import { createCarAudio } from './car-audio.js';
import { newDamage, addImpact, damageMods, damageLevel, applyDamage, createCarFx, DAMAGE_LEVELS } from './car-damage.js';

const { RAMPS, SITE_CENTER } = DATA;
const PARKING = DATA.PARKING || {};
const EYE = 1.62;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerpN = (a, b, t) => a + (b - a) * t;
const sstep = t => { t = clamp(t); return t * t * (3 - 2 * t); };
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
const frame = () => new Promise(r => requestAnimationFrame(() => r(performance.now())));

const CAR_PARK_LIMIT = 20, STREET_LIMIT = 50;          // km/h shown on the sign (a hint, as on a real site)
const CAR_PARK_CAP = 40, RAMP_CAP = 36, OFFROAD_CAP = 70;   // km/h the limiter of the place allows (on a street: the car's own top speed)
const SESSION_DMG = new Map();                        // record id → damage record: a car stays damaged for the page session
const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
const carMass = S => ((S.perf && S.perf.mass) || 1) * 1600;
const TICK_MS = 100;                                  // drive:tick events (10 per second)
// V10 driver's view: the resting gaze turns this much towards the middle of the car (rad; + = the driver's side) and down
const FP_YAW = -0.1, FP_PITCH = -0.07;
// V19: bonnet + instruments in the driver's view. S = carSpec, eye = the head point (car frame: +z forward, +x driver's side).
// → { raise (m), pts: [bonnet front corners, bonnet rear point, cluster corners] (car frame), hoodRear, binnacle }
const _hRay = new THREE.Raycaster(), _hV = new THREE.Vector3(), _hD = new THREE.Vector3(), _hM = new THREE.Matrix4();
const HOOD_SKIP = /glass|mirror|cluster|screen|wiper|plate/i;
function fpHoodKeys(S, eye, car = null) {
  const sh = S.sh || [], G = S.gh || {}; if (!sh.length || G.zA == null) return { raise: 0, pts: [] };
  // measured on the car's own meshes (car frame): the bonnet surface under the target, then the lowest seat height (1 cm steps,
  // ≤ 12 cm, under the roof) from which nothing of the cabin / body stands between the eye and the bonnet
  if (car && car.group) {
    try {
      const meshes = []; car.group.updateMatrixWorld(true); _hM.copy(car.group.matrixWorld).invert();
      car.group.traverse(o => { if (o.isMesh && o.visible !== false && !HOOD_SKIP.test(o.name || '') && !(o.parent && /cockpit-mirror/.test(o.parent.name || ''))) meshes.push(o); });
      const W = (x, y, z) => car.group.localToWorld(_hV.set(x, y, z)).clone();
      const zA = G.zA, zT = zA + 0.24, x = (S.driverX ?? eye.x) * 0.6;
      const top = W(x, S.H + 0.5, zT); _hRay.set(top, _hD.set(0, -1, 0).transformDirection(car.group.matrixWorld)); _hRay.far = S.H + 1;
      const hit = _hRay.intersectObjects(meshes.filter(m => m.name === 'paint'), false)[0];
      if (hit) {
        const T = hit.point.clone().applyMatrix4(_hM); T.y += 0.025;
        const clear = (dy) => { const e = W(eye.x, eye.y + dy, eye.z), t = W(T.x, T.y, T.z), d = t.clone().sub(e), L = d.length(); _hRay.set(e, d.divideScalar(L)); _hRay.far = L - 0.05; return !_hRay.intersectObjects(meshes, false).length; };
        const cap = Math.min(0.12, Math.max(0, (S.H - 0.1) - eye.y)); let raise = null;
        for (let dy = 0; dy <= cap + 1e-6; dy += 0.01) if (clear(dy)) { raise = dy; break; }
        const base = fpHoodKeys(S, eye, null);
        base.raise = raise == null ? cap : Math.min(cap, raise + 0.015); base.measured = raise != null; base.hoodRear = { x: T.x, y: T.y, z: T.z }; base.pts[3] = new THREE.Vector3(T.x, T.y, T.z);
        return base;
      }
    } catch (e) { /* fall back to the estimate */ }
  }
  const shf = z => { if (z <= sh[0][0]) return sh[0][1]; for (let i = 1; i < sh.length; i++) if (z <= sh[i][0]) { const [z0, y0] = sh[i - 1], [z1, y1] = sh[i]; return y0 + (y1 - y0) * (z - z0) / (z1 - z0 || 1); } return sh[sh.length - 1][1]; };
  const zA = G.zA, zN = sh[sh.length - 1][0] - 0.16, dh = shf(zA) - 0.035, dRear = (S.seat ?? eye.z) + 0.68;
  const T = { x: eye.x * 0.6, y: shf(zA + 0.22) + 0.02, z: zA + 0.22 };                      // the bonnet just ahead of the windscreen
  const occ = [{ y: dh + 0.155, z: dRear + 0.02 }, { y: shf(zA - 0.04) + 0.012, z: zA - 0.04 }];   // binnacle top, dash top at the glass
  let need = eye.y;
  for (const O of occ) { const a = (O.z - eye.z) / (T.z - eye.z); if (a > 0 && a < 1) need = Math.max(need, (O.y - a * T.y) / (1 - a) + 0.03); }
  const cap = Math.min(0.12, Math.max(0, (S.H - 0.11) - eye.y));
  const raise = Math.max(0, Math.min(cap, need - eye.y));
  const yN = shf(zN) + 0.01, hw = (S.W || 1.9) * 0.36, cx = S.driverX ?? eye.x, cy = dh + 0.085, cz = dRear + 0.023;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const pts = [P(hw, yN, zN), P(-hw, yN, zN), P(0, yN + 0.01, zN), P(T.x, T.y, T.z), P(cx - 0.17, cy - 0.06, cz), P(cx + 0.17, cy - 0.06, cz), P(cx - 0.17, cy + 0.06, cz), P(cx + 0.17, cy + 0.06, cz)];
  return { raise, need: +(need - eye.y).toFixed(3), pts, hoodRear: T, front: { y: yN, z: zN }, cluster: { x: cx, y: cy, z: cz } };
}
// camera-frame point (x right, y up, −z ahead) → projection plane: Panini d = 1 (pan) or a plain lens; and back to a plain lens
const NOOP = function () {};
function fpProj(x, y, z, pan) { const d = Math.max(0.02, -z); if (!pan) return [x / d, y / d]; const th = Math.atan2(x, d), S = 2 / (1 + Math.cos(th)); return [S * Math.sin(th), S * y / Math.hypot(x, d)]; }
function fpInv(xp, yp, pan) { if (!pan) return [xp, yp]; const th = 2 * Math.atan(xp / 2), S = 2 / (1 + Math.cos(th)); return [Math.tan(th), yp / S / Math.cos(th)]; }
// portrait (aspect below FP_DECK_ASPECT): the 3D band's largest vertical angle (°), the room kept above the glass for the title card,
// the deck's smallest height (px) and the band's smallest share of the screen height
const FP_DECK_ASPECT = 1.05, FP_VMAX = 112, FP_DECK_TOP = 58, FP_DECK_MIN = 300, FP_BAND_MIN = 0.42;
// landscape / desktop: the room kept above the glass for the title card (px)
const FP_TOP_UI = 56;

const CSS = `
.vw-dx{position:absolute;display:flex;gap:8px;align-items:center;direction:ltr}
.vw-dx button{pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none}
.vw-dgear{min-width:54px;height:44px;border-radius:12px;border:1px solid var(--ln);background:var(--bg);color:var(--g2);font:700 15px/1 "Manrope","Inter Tight",Arial,sans-serif;letter-spacing:.08em;display:inline-flex;align-items:center;justify-content:center;gap:5px;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.vw-dgear i{font-style:normal;opacity:.38}.vw-dgear i.on{opacity:1;color:#111;background:linear-gradient(180deg,#f0d596,#b88a3c);border-radius:6px;padding:4px 6px;margin:0 -2px}
.vw-dround{width:44px;height:44px;border-radius:50%;border:1px solid var(--ln);background:var(--bg);color:var(--g2);display:inline-flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.vw-dround.on{color:#111;background:linear-gradient(180deg,#f0d596,#b88a3c);border-color:transparent}
.vw-dxr{right:calc(12px + var(--sr));bottom:calc(150px + var(--sb))}
.vw:not(.phone) .vw-dxr{bottom:calc(22px + var(--sb))}
.vw-dname{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(146px + var(--sb));padding:5px 12px;border-radius:999px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#e9dfc8;background:rgba(8,8,8,.5);white-space:nowrap;pointer-events:none!important;unicode-bidi:plaintext}
.vw.phone .vw-dname{bottom:calc(126px + var(--sb));font-size:10px}
.vw-dname b{color:var(--g2);font-weight:600}
.vw.driving .vw-dname{animation:vwdname 7s ease forwards}
@keyframes vwdname{0%,70%{opacity:1}100%{opacity:0}}
.vw-dtop .vw-ico[data-kd]{width:40px;padding:0;justify-content:center}
.vw.phone .vw-steer{width:158px;height:72px;border-radius:36px}
.vw.phone .vw-steer .knob{width:48px;height:48px;margin:-24px 0 0 -24px}
.vw.phone .vw-pedals .brake{width:70px;height:84px}.vw.phone .vw-pedals .gas{width:62px;height:118px}
@media (orientation:portrait){
  .vw.phone .vw-spdo{bottom:calc(150px + var(--sb));width:96px;height:96px;left:calc(12px + var(--sl));transform:none}
  .vw.phone .vw-spdo .num b{font-size:29px}
  .vw.phone .vw-dname{bottom:calc(254px + var(--sb))}
  .vw.phone .vw-dxr{bottom:calc(150px + var(--sb))}
  .vw.phone .vw-dtop{flex-wrap:wrap;justify-content:flex-end;max-width:calc(100% - 20px - var(--sl) - var(--sr))}
}
@media (orientation:landscape){
  .vw.phone .vw-dxr{bottom:calc(142px + var(--sb));flex-wrap:wrap-reverse;justify-content:flex-end;max-width:100px}
  .vw.phone .vw-steer{left:calc(18px + var(--sl))}
}
.vw-dmenu{display:contents}
.vw-dmorebtn{display:none!important}
.vw.phone .vw-dmorebtn{display:inline-flex!important;position:relative}
.vw-dmorebtn.lit::after{content:"";position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:#f0b04a;box-shadow:0 0 5px #f0b04a}
.vw.phone .vw-dmenu{display:none;position:absolute;top:calc(100% + 6px);right:0;gap:6px;padding:6px;border-radius:14px;background:rgba(12,11,9,.86);border:1px solid rgba(201,164,92,.32);z-index:4;flex-wrap:nowrap}
.vw[dir=rtl].phone .vw-dmenu{right:auto;left:0}
.vw.phone.dmenu-open .vw-dmenu{display:flex}
.vw.phone.drive-deck .vw-dmenu{top:auto;bottom:calc(100% + 6px)}
.vw.phone .vw-dtop [data-k=carview] .lbl{display:none}.vw.phone .vw-dtop [data-k=carview]{width:40px;padding:0;justify-content:center}
.vw.driving .vw-drive{container-type:size;container-name:vwdrive}
@container vwdrive (max-width:352px){
  .vw.phone:not(.drive-deck) .vw-spdo{width:74px!important;height:74px!important}
  .vw.phone:not(.drive-deck) .vw-spdo .num b{font-size:23px!important}
}
/* V21: © OpenStreetMap (environment.js puts it bottom-right) was lying over the gas pedal on phones (and took its taps) */
.vw.phone.driving .vrc-osm-attribution{right:auto!important;left:calc(8px + var(--sl))!important;bottom:calc(134px + var(--sb))!important}
@media (orientation:landscape){.vw.phone.driving .vrc-osm-attribution{bottom:calc(124px + var(--sb))!important}}
.vw.phone.driving.drive-deck .vrc-osm-attribution{left:auto!important;right:calc(6px + var(--sr))!important;bottom:calc(var(--deck) + 4px)!important}
/* V21: desktop chase view — the radio button and the radio bar were centred on the speedometer (overlap) */
.vw.driving:not(.phone):not(.drive-fp) .vw-dradiobtn{left:calc(50% - 120px)!important;bottom:calc(22px + var(--sb))!important}
.vw.driving:not(.phone):not(.drive-fp) .vw-dradio{bottom:calc(152px + var(--sb))!important}
.vw.tilt .vw-steer{opacity:.35}
.vw:not(.phone) .vw-dhand{display:none}
.vw.drive-fp:not(.phone) .vw-spdo{opacity:0;pointer-events:none}
.vw.drive-fp:not(.phone) .vw-dradio{bottom:calc(22px + var(--sb))}
.vw.drive-fp:not(.phone) .vw-dname{bottom:calc(70px + var(--sb))}
.vw-dradio{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(150px + var(--sb));display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:999px;border:1px solid var(--ln);background:var(--bg);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);direction:ltr;max-width:calc(100% - 16px - var(--sl) - var(--sr))}
.vw-dradio button{pointer-events:auto;width:34px;height:34px;flex:none;border-radius:50%;border:0;background:transparent;color:var(--g2);display:inline-flex;align-items:center;justify-content:center;font-size:13px;touch-action:manipulation}
.vw-dradio button:active{background:rgba(201,164,92,.25)}
.vw-dradio .st{min-width:0;max-width:200px;padding:0 6px;display:flex;flex-direction:column;align-items:center;line-height:1.15;pointer-events:none!important;unicode-bidi:plaintext}
.vw-dradio .st b{font-size:12px;font-weight:600;color:#f1e7cf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.vw-dradio .st i{font-style:normal;font-size:9.5px;letter-spacing:.08em;color:#bfb497;white-space:nowrap}
.vw-dradio.off .st b{opacity:.55}.vw-dradio [data-kr=power].on{color:#111;background:linear-gradient(180deg,#f0d596,#b88a3c)}
.vw-dradio.live .st i{color:#7fe08f}
.vw:not(.phone) .vw-dname{bottom:calc(198px + var(--sb))}
.vw.phone .vw-dradio{bottom:calc(128px + var(--sb))}
.vw.phone .vw-dradio .st{max-width:132px}
@media (orientation:portrait){.vw.phone .vw-dradio{bottom:calc(256px + var(--sb))}.vw.phone .vw-dname{bottom:calc(304px + var(--sb))}}
@media (orientation:landscape){.vw.phone .vw-dradio{bottom:auto;top:calc(56px + var(--st));left:calc(12px + var(--sl));transform:none}.vw[dir=rtl].phone .vw-dradio{left:auto;right:calc(12px + var(--sr))}.vw.phone .vw-dradio .st{max-width:150px}.vw.phone .vw-dname{bottom:calc(126px + var(--sb))}}
/* V10: the controls keep to the edges and the bottom strip, small and see-through, so the windscreen and the side windows stay
   free (no backdrop blur: lighter on phones). The radio folds into a button; open, it floats above the bottom controls. */
.vw-dradiobtn{position:absolute;left:calc(12px + var(--sl));bottom:calc(84px + var(--sb));width:42px;height:42px;pointer-events:auto;touch-action:manipulation}
.vw[dir=rtl] .vw-dradiobtn{left:calc(12px + var(--sl))}
.vw-dradiobtn .dot{position:absolute;right:7px;top:7px;width:7px;height:7px;border-radius:50%;background:#7fe08f;opacity:0;box-shadow:0 0 6px #7fe08f}
.vw-dradiobtn.play .dot{opacity:1}.vw-dradiobtn.on .dot{background:#111;box-shadow:none}
.vw.driving:not(.radio-open) .vw-dradio{display:none}
.vw:not(.phone) .vw-dradiobtn{left:calc(50% - 21px);bottom:calc(22px + var(--sb))}.vw.radio-open:not(.phone) .vw-dradiobtn{bottom:calc(72px + var(--sb))}
.vw.drive-fp:not(.phone) .vw-dradio,.vw:not(.phone) .vw-dradio{bottom:calc(22px + var(--sb))}
.vw.phone .vw-dradio{bottom:calc(166px + var(--sb))!important;top:auto!important;left:50%!important;right:auto!important;transform:translateX(-50%)!important;background:rgba(12,11,9,.72);-webkit-backdrop-filter:none;backdrop-filter:none}
.vw.phone .vw-dround,.vw.phone .vw-dgear{background:rgba(12,11,9,.42);-webkit-backdrop-filter:none;backdrop-filter:none;border-color:rgba(201,164,92,.28)}
.vw.phone .vw-dround{width:42px;height:42px}.vw.phone .vw-dgear{height:42px;min-width:52px;font-size:14px}
.vw.phone .vw-dround.on{background:linear-gradient(180deg,#f0d596,#b88a3c)}
.vw.phone .vw-dx{gap:6px}
.vw.phone .vw-steer{width:clamp(100px,calc(100% - 300px - var(--sl) - var(--sr)),160px);height:52px;border-radius:26px;left:calc(10px + var(--sl));bottom:calc(14px + var(--sb));background:rgba(12,11,9,.36);border-color:rgba(201,164,92,.26);-webkit-backdrop-filter:none;backdrop-filter:none}
.vw.phone .vw-steer .knob{width:42px;height:42px;margin:-21px 0 0 -21px;opacity:.9}
.vw.phone .vw-pedals{right:calc(10px + var(--sr));bottom:calc(12px + var(--sb));gap:7px}
.vw.phone .vw-pedals button{background:linear-gradient(180deg,rgba(40,36,28,.45),rgba(10,10,10,.5));border-color:rgba(201,164,92,.3)}
.vw.phone .vw-pedals button i{inset:7px 8px 22px}
.vw.phone .vw-pedals .brake{width:54px;height:66px}.vw.phone .vw-pedals .gas{width:46px;height:92px}
.vw.phone .vw-pedals button.on{background:linear-gradient(180deg,#e6c987,#b88a3c)}
.vw.phone .vw-spdo{left:50%!important;transform:translateX(-50%)!important;bottom:calc(10px + var(--sb))!important;width:84px!important;height:84px!important;background:radial-gradient(circle at 50% 40%,rgba(28,24,17,.62),rgba(6,6,6,.55) 70%);box-shadow:0 4px 14px rgba(0,0,0,.3)}
.vw.phone .vw-spdo .num b{font-size:27px!important;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.vw.phone .vw-spdo .num i{font-size:8px;margin-top:2px}.vw.phone .vw-spdo .gear{bottom:8px;font-size:10px}
.vw.phone .vw-spdo .lim{width:28px;height:28px;right:-10px;top:-6px;font-size:11px;line-height:21px;border-width:3px}
.vw.phone .vw-dxr{right:calc(10px + var(--sr));bottom:calc(114px + var(--sb))!important}
.vw.phone .vw-dname{bottom:calc(214px + var(--sb))!important}
@media (orientation:landscape){
  .vw.phone .vw-dxr{right:calc(126px + var(--sr));bottom:calc(10px + var(--sb))!important}
  .vw.phone .vw-spdo{left:auto!important;right:calc(298px + var(--sr));transform:none!important;width:74px!important;height:74px!important;bottom:calc(8px + var(--sb))!important}
  .vw.phone .vw-spdo .num b{font-size:23px!important}
  .vw.phone .vw-dradiobtn{bottom:calc(74px + var(--sb))}
  .vw.phone .vw-dradio{bottom:calc(122px + var(--sb))!important}
  .vw.phone .vw-dname{bottom:calc(66px + var(--sb))!important}
}
/* V10 portrait driver's view: the 3D picture is a band at the top, this deck fills the screen below it (height --deck) */
.vw-ddeck{display:none}
.vw.driving.drive-deck .vw-ddeck{display:block;position:absolute;left:0;right:0;bottom:0;height:var(--deck);pointer-events:none!important;
  background:linear-gradient(180deg,#26221b 0,#15130f 10px,#0f0e0c 38%,#090908 100%);border-top:1px solid rgba(201,164,92,.38);box-shadow:0 -10px 24px rgba(0,0,0,.35)}
.vw.driving.drive-deck .vw-ddeck::before{content:"";position:absolute;left:14px;right:14px;top:7px;border-top:1px dashed rgba(201,164,92,.22)}
.vw.drive-deck .vw-dtop{top:auto!important;bottom:calc(var(--deck) - 104px);right:calc(10px + var(--sr));left:auto;max-width:calc(100% - 136px);flex-wrap:wrap;justify-content:flex-end;gap:6px}
.vw[dir=rtl].drive-deck .vw-dtop{right:calc(10px + var(--sr));left:auto}
.vw.phone.drive-fp .vw-dtop [data-k=carview] .lbl{display:none}.vw.phone.drive-fp .vw-dtop [data-k=carview]{width:40px;padding:0;justify-content:center}
@media (orientation:landscape){.vw.phone.drive-fp .vw-dtop{gap:5px}.vw.phone.drive-fp .vw-dtop .vw-btn{height:36px;opacity:.88}.vw.phone.drive-fp .vw-dtop .vw-ico,.vw.phone.drive-fp .vw-dtop [data-k=carview]{width:36px}}
.vw.drive-deck .vw-spdo{left:calc(12px + var(--sl))!important;right:auto!important;transform:none!important;bottom:calc(var(--deck) - 122px)!important;width:104px!important;height:104px!important;opacity:1!important;pointer-events:auto}
.vw.drive-deck .vw-spdo .num b{font-size:32px!important}
.vw.drive-deck .vw-spdo .lim{width:32px;height:32px;right:-8px;top:-4px;font-size:12px;line-height:25px}
.vw.drive-deck .vw-dradio{display:flex!important;bottom:calc(var(--deck) - 178px)!important;left:50%!important;transform:translateX(-50%)!important;width:calc(100% - 20px);justify-content:space-between;background:rgba(0,0,0,.35)}
.vw.drive-deck .vw-dradio .st{max-width:none;flex:1}
.vw.drive-deck .vw-dradiobtn{display:none}
.vw.drive-deck .vw-steer{width:clamp(100px,calc(100% - 186px - var(--sl) - var(--sr)),200px);height:70px;border-radius:35px;bottom:calc(16px + var(--sb))}
.vw.drive-deck .vw-steer .knob{width:52px;height:52px;margin:-26px 0 0 -26px}
.vw.drive-deck .vw-pedals .brake{width:66px;height:88px}.vw.drive-deck .vw-pedals .gas{width:58px;height:126px}
.vw.drive-deck .vw-dxr{right:auto;left:calc(10px + var(--sl));bottom:calc(100px + var(--sb))!important}
.vw.drive-deck .vw-dname{bottom:calc(166px + var(--sb))!important;animation:none;opacity:.75;background:none;font-size:10px;letter-spacing:.2em}
.vw.drive-deck .vw-dhint{display:none}
`;
const ICON = {
  more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  indL: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 12l8-7v4.5h10v5H11V19z"/></svg>',
  indR: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12l-8-7v4.5H3v5h10V19z"/></svg>',
  hazard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5L21.5 20h-19z"/><path d="M12 9.5L16.4 17H7.6z"/></svg>',
  wipers: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 19a13 13 0 0 1 18 0"/><path d="M8 19l-2.5-9M16 19l2.5-9"/></svg>',
  horn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h3l6 4V6l-6 4z"/><path d="M16.5 9.5c1 .7 1.5 1.5 1.5 2.5s-.5 1.800-1.500 2.500M19 7c1.600 1.300 2.500 3 2.500 5s-.9 3.700-2.500 5"/></svg>',
  tilt: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="18" rx="1.8" transform="rotate(-20 12 12)"/><path d="M3 8c.6-2 1.800-3.400 3.500-4.200M21 16c-.6 2-1.800 3.400-3.500 4.200"/></svg>',
  reset: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.600-5.900"/><path d="M4 4v4.500h4.500"/></svg>',
  prev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14l-10-7z"/></svg>',
  next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l10-7z"/></svg>',
  volDn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.500L12 6v12l-4.500-3.500H4z"/><path d="M16 12h5"/></svg>',
  volUp: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.500L12 6v12l-4.500-3.500H4z"/><path d="M16 12h5M18.500 9.500v5"/></svg>',
  hand: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6.2"/><path d="M4.600 6.500a9.500 9.500 0 0 0 0 11M19.400 6.500a9.500 9.500 0 0 1 0 11"/><path d="M10.500 15v-6h2.200a1.800 1.800 0 0 1 0 3.600h-2.200"/></svg>',
  radio: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M7 9l10-5"/><circle cx="15.500" cy="14.500" r="2.300"/><path d="M6.500 13h4M6.500 16h4"/></svg>',
  power: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3.500v8"/><path d="M6.600 6.800a7.500 7.500 0 1 0 10.800 0"/></svg>',
};

export const driveMixin = {
  // ======================= the cars of the car park =======================
  // New car park (drawing): PARKING.bays of data.js → cars.js parkingCars() fills about two thirds of them by its rules.
  // Old car park: the builder's own list `parkedCars`. This is the one place that knows both.
  _parkingBays(c) {
    if (Array.isArray(PARKING.bays) && PARKING.bays.length) return { bays: PARKING.bays, src: 'data' };
    const b = c && c.parking && c.parking.bays;
    if (Array.isArray(b) && b.length && b[0].yaw != null && b[0].x != null) return { bays: b, src: 'builder' };
    return null;
  },
  _adoptParking(c) {
    const C = this.mods.cars;
    if (!this.fleet || !c || !C) return;
    try {
      const P = this._parkingBays(c), y = PARKING.y ?? -4.2;
      let list = null;
      if (P && P.src === 'data' && C.parkingCars) list = C.parkingCars(P.bays, { y });
      else if (Array.isArray(c.parkedCars) && c.parkedCars.length) list = c.parkedCars;
      else if (P && C.parkingCars) list = C.parkingCars(P.bays, { y });
      if (list && list.length) {
        // a car that would stand in a wall or a column is left out (the drawing wins over the dice)
        const veto = P && P.src === 'data' ? q => this._spotFree(q, true) : null;
        if (this.fleet.add(list, 'parking', veto).length) this._registerCars();
      }
      if (c.carInstances && c.carInstances.group) c.carInstances.group.visible = false;   // the fleet draws them now
      this._initBarriers();
    } catch (e) { console.warn('[walk] parked cars', e); }
  },
  // a parked car at c = {kind, x, y, z, yaw} touches no wall / building (and, unless wallsOnly, no other car)
  _spotFree(c, wallsOnly = false) {
    const S = this.mods.cars.carSpec(c.kind), ctl = { S, rec: { collider: null }, v: 1, _wallsOnly: wallsOnly };
    for (const v of [1, -1]) { ctl.v = v; if (this._carBlocked(ctl, c.x, c.z, c.yaw, c.y)) return false; }
    return true;
  },

  // ======================= barriers at the ramps =======================
  // One boom per ramp, just outside its portal (or at RAMPS[].gate when the data places it). It lifts when a car comes
  // near from either side and drops behind it; while it is down it is solid.
  _initBarriers() {
    if (this._barriers || !this.mods.cars || !this.mods.cars.rampModel) return;
    this._barriers = [];
    // the car-park builder may draw its own boom: then only the logic is added here
    let own = false; if (this.commons && this.commons.group) this.commons.group.traverse(o => { if (/barrier|boom/i.test(o.name || '') && o.userData && o.userData.arm) own = true; });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    const box = (w, h, d, x, y, z, hex) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const merge = list => { const n = list.reduce((s, g) => s + g.attributes.position.count, 0), P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3); let o = 0; for (const g of list) { P.set(g.attributes.position.array, o); N.set(g.attributes.normal.array, o); Cc.set(g.attributes.color.array, o); o += g.attributes.position.count * 3; g.dispose(); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(Cc, 3)); return g; };
    for (const R of RAMPS) {
      const m = this.mods.cars.rampModel(R), [dx, dz] = m.dirTop;
      let px = m.pts[0][0] + dx * 1.6, pz = m.pts[0][2] + dz * 1.6, py = m.y0 > 0.02 ? m.y0 * (1 - 1.6 / 3.2) : 0, ax = dx, az = dz, hw = m.hw;
      const gate = R.gate && Array.isArray(R.gate.p) && /barrier|boom|шлагбаум/i.test(String(R.gate.kind || 'barrier')) ? R.gate : null;
      if (gate) {   // nearest point of the ramp path gives the level and the direction
        let best = null; for (let i = 0; i + 1 < m.pts.length; i++) { const a = m.pts[i], b = m.pts[i + 1], ux = b[0] - a[0], uz = b[2] - a[2], L2 = ux * ux + uz * uz || 1, t = clamp(((gate.p[0] - a[0]) * ux + (gate.p[1] - a[2]) * uz) / L2), qx = a[0] + ux * t, qz = a[2] + uz * t, d = Math.hypot(gate.p[0] - qx, gate.p[1] - qz); if (!best || d < best.d) best = { d, y: a[1] + (b[1] - a[1]) * t, ux: -ux / Math.sqrt(L2), uz: -uz / Math.sqrt(L2) }; }
        if (best && best.d < 12) { px = gate.p[0]; pz = gate.p[1]; py = best.y; ax = best.ux; az = best.uz; hw = (gate.w || m.hw * 2) / 2; }
      }
      // across the ramp: the post stands on the right of a car driving OUT (right of (ax, az) is (−az, ax))
      const rx = -az, rz = ax, L = hw * 2 - 0.5;
      const B = { id: R.id, x: px, y: py, z: pz, ax, az, rx, rz, hw, L, t: 0, group: null, arm: null, own };
      if (!own) {
        const g = new THREE.Group(); g.name = 'walk-barrier-' + R.id; g.position.set(px + rx * (hw - 0.22), py, pz + rz * (hw - 0.22)); g.rotation.y = Math.atan2(ax, az);
        const post = new THREE.Mesh(merge([box(0.3, 1.05, 0.34, 0, 0.525, 0, '#2c2f33'), box(0.32, 0.08, 0.36, 0, 1.09, 0, '#e3b21c'), box(0.06, 0.06, 0.02, 0, 0.8, 0.18, '#d02a1e')]), mat);
        const armParts = []; const n = Math.max(4, Math.round(L / 0.5));
        for (let i = 0; i < n; i++) armParts.push(box(L / n, 0.09, 0.05, -(i + 0.5) * L / n, 0, 0, i % 2 ? '#c8231e' : '#f2f2ee'));
        const arm = new THREE.Mesh(merge(armParts), mat); arm.position.set(-0.05, 0.98, 0.0);   // local −x points across the ramp towards the far side
        g.add(post, arm); this.scene.add(g); B.group = g; B.arm = arm;
      }
      this._barriers.push(B);
    }
  },
  _barrierUpdate(dt, p) {
    if (!this._barriers) return;
    for (const B of this._barriers) {
      // distance along the ramp direction (+ = street side) and across it
      const ox = p.x - B.x, oz = p.z - B.z, s = ox * B.ax + oz * B.az, c = Math.abs(ox * B.rx + oz * B.rz);
      const near = this.drive && c < B.hw + 3 && s > -9 && s < 11 && Math.abs(p.y - B.y) < 3;
      B.t += ((near ? 1 : 0) - B.t) * damp(near ? 3.6 : 2.2, dt);
      if (B.arm) { B.arm.rotation.z = -sstep(B.t) * 1.42; B.arm.updateMatrixWorld(true); }
    }
  },
  // the raised divider between the two lanes of a ramp (0.18 m kerb with pylons on the drawing) is solid for a car
  _islandBlocks(x, z, yaw, S) {
    if (!this._islands) {
      this._islands = [];
      for (const R of RAMPS) { const K = R.kerbs; if (!K || !Array.isArray(K.div) || K.divEnd == null || !R.topPoint) continue;
        const ax = R.axis === 'z', top = (ax ? R.topPoint[2] : R.topPoint[0]) + (R.dirUp ? R.dirUp[ax ? 1 : 0] : -1) * 1.2, a0 = Math.min(K.divEnd, top), a1 = Math.max(K.divEnd, top), c0 = Math.min(...K.div) + 0.04, c1 = Math.max(...K.div) - 0.04;
        this._islands.push(ax ? { x0: c0, x1: c1, z0: a0, z1: a1 } : { x0: a0, x1: a1, z0: c0, z1: c1 }); }
    }
    for (const I of this._islands) {
      if (x < I.x0 - 4 || x > I.x1 + 4 || z < I.z0 - 4 || z > I.z1 + 4) continue;
      if (this.mods.cars.quadsOverlap(this.mods.cars.carCorners(S.kind, x, z, yaw, 0), [[I.x0, I.z0], [I.x1, I.z0], [I.x1, I.z1], [I.x0, I.z1]])) return true;
    }
    return false;
  },
  _barrierBlocks(quad, y) {
    if (!this._barriers) return false;
    const Q = this.mods.cars.quadsOverlap;
    for (const B of this._barriers) {
      if (B.t > 0.55 || Math.abs(y - B.y) > 1.6) continue;
      const a = [B.x + B.rx * B.hw, B.z + B.rz * B.hw], b = [B.x - B.rx * B.hw, B.z - B.rz * B.hw], t = 0.12;
      if (Q(quad, [[a[0] + B.ax * t, a[1] + B.az * t], [b[0] + B.ax * t, b[1] + B.az * t], [b[0] - B.ax * t, b[1] - B.az * t], [a[0] - B.ax * t, a[1] - B.az * t]])) return true;
    }
    return false;
  },

  // ======================= hooks for the next wave (people, police, damage) =======================
  // Events (walk.onDrive(type, cb) → unsubscribe; also re-sent on window as CustomEvent 'vrc:drive' with detail {type, …}):
  //   'drive:enter'     { car }                       the visitor sat down in `car`
  //   'drive:exit'      { car }                       … and got out (car = the record left standing)
  //   'drive:tick'      { car, pos: {x, y, z}, vel: {x, z}, speedKmh, heading, steer, braking, onRoad }   10 × per second while driving
  //   'drive:collision' { car, impulse (kg·m/s), speed (m/s lost), hard, point: [x, y, z], normal: [x, z], other }
  //                     other = a fleet record / a traffic car / { building } / 'kerb' / null (wall, column, barrier)
  //   'drive:horn'      { car, on }
  //   'drive:radio'     { car, on, station, status }
  // `car` is always the fleet RECORD of the car: { id (stable: 'bay:1/16', 'kerb:3', 'traffic:7' …), kind, colour, x, y, z, yaw,
  // src, bay, driver (a slot for people.js), disabled, collider }.
  _bus() { return this._dbus || (this._dbus = new Map()); },
  onDrive(type, cb) { if (type !== '*' && !/^drive:/.test(type)) type = 'drive:' + type; const m = this._bus(); if (!m.has(type)) m.set(type, new Set()); m.get(type).add(cb); return () => this.offDrive(type, cb); },
  offDrive(type, cb) { if (type !== '*' && !/^drive:/.test(type)) type = 'drive:' + type; const s = this._bus().get(type); if (s) s.delete(cb); },
  _emitDrive(type, detail) {
    const s = this._bus().get(type), all = this._bus().get('*');
    for (const set of [s, all]) if (set) for (const cb of [...set]) { try { cb(detail, type); } catch (e) { console.warn('[drive] listener', type, e); } }
    if (type !== 'drive:tick') { try { window.dispatchEvent(new CustomEvent('vrc:drive', { detail: { type, ...detail } })); } catch { /* no window */ } }
  },
  /** The car the visitor drives now: its fleet record + live numbers, or null on foot. */
  getPlayerCar() {
    const D = this.drive; if (!D) return null; const c = D.ctl;
    return { car: D.rec, id: D.rec.id, kind: D.rec.kind, name: c.S.name, plate: D.car.plate || '', x: c.x, y: c.y, z: c.z, yaw: c.yaw, v: c.v, pos: { x: c.x, y: c.y, z: c.z }, heading: c.yaw, vel: { x: Math.sin(c.yaw) * c.v, y: 0, z: Math.cos(c.yaw) * c.v }, speedKmh: c.v * 3.6,
      mass: carMass(c.S), spec: c.S, ctl: c, model: D.car, group: D.car.group, driver: D.rec.driver, disabled: !!c.disabled,
      box: this.mods.cars.carCorners(c.S.kind, c.x, c.z, c.yaw, 0), size: { L: c.S.L, W: c.S.W, H: c.S.H, zF: c.S.zF, zR: c.S.zR }, damage: D.rec.dmg || null, damageLevel: damageLevel(D.rec.dmg), slip: c.beta, steer: c.steer, braking: c.braking, horn: !!this._hornOn };
  },
  /** cb(car) for every moving traffic car: { id, x, y, z, yaw, v (m/s along its lane), vx, vz, kind, colour, driver (slot), disabled }. */
  forEachTrafficCar(cb) { const tr = this._trafficRef(); if (tr && tr.forEach) tr.forEach(cb); else if (tr && tr.cars) for (const c of tr.cars) if (!c.taken) cb(c); },
  /** Turn a traffic car into a parked fleet car where it stands and (unless enter === false) put the visitor into it. → the fleet record | null */
  async takeTrafficCar(car, { enter = true } = {}) {
    const tr = this._trafficRef(); if (!tr || !tr.take || !this.fleet || !car) return null;
    if (enter && this.drive) return null;                                   // get out of the present car first
    const p = tr.take(typeof car === 'string' ? tr.cars.find(c => c.id === car) : car); if (!p) return null;
    const rec = this.fleet.addOne({ ...p, src: 'taken' }); this._registerCars();
    this.fleet.update(this.camera, true);
    if (enter) await this._enterCar(rec, { gesture: false });
    return rec;
  },
  _findCar(car) {
    if (!car) return null;
    if (typeof car === 'string') { const r = this.fleet && this.fleet.byId(car); if (r) return r; const tr = this._trafficRef(); return (tr && tr.cars && tr.cars.find(c => c.id === car)) || null; }
    return car.car || car;
  },
  /** A disabled car has no drive (it still rolls, steers and brakes). Works for the visitor's car, parked cars and traffic. */
  setCarDisabled(car, on = true) {
    const c = this._findCar(car); if (!c) return false; c.disabled = !!on;
    if (this.drive && this.drive.rec === c) { this.drive.ctl.disabled = !!on; this._renderDriveHud(true); }
    return true;
  },
  /** A shove in m/s (world): addCarImpulse(car, [vx, vz]) | (car, {x, z}) | (car, vx, vz). The visitor's car takes it in full; a traffic car along its lane; a parked car remembers it (rec.impulse). */
  addCarImpulse(car, v, vz2) {
    const c = this._findCar(car); if (!c || v == null) return false;
    const vx = typeof v === 'number' ? v : Array.isArray(v) ? v[0] : v.x || 0, vz = typeof v === 'number' ? +vz2 || 0 : Array.isArray(v) ? v[1] : v.z || 0;
    if (this.drive && this.drive.rec === c) { this.drive.ctl.addImpulse(vx, vz); return true; }
    if (c.path != null && 'v0' in c) { c.push = (c.push || 0) + vx * Math.sin(c.yaw) + vz * Math.cos(c.yaw); return true; }
    c.impulse = [(c.impulse ? c.impulse[0] : 0) + vx, (c.impulse ? c.impulse[1] : 0) + vz]; return true;
  },

  /** Open / close the driver's door of a parked or the driven car (only a car near enough to have its detailed model moves). */
  openCarDoor(car, on = true) { const c = this._findCar(car), m = c && this.fleet && this.fleet.carOf(c); if (!m || !m.setDoor) return false; this._doorSwing(m, m.doorOpen, on ? 1 : 0, 300); return true; },
  /** Stop a traffic car where it is (its driver brakes to a halt and waits) or let it go on: stopCar(car, on = true). Works on a fleet car too (= setCarDisabled). */
  stopCar(car, on = true) { const c = this._findCar(car); if (!c) return false; if (c.path != null && 'v0' in c) { c.disabled = !!on; return true; } return this.setCarDisabled(c, on); },
  /** The whole takeover of a car: a traffic car is stopped, leaves the traffic and becomes a fleet car where it stands, its driver's door opens
   *  and the visitor is seated in it (the driver, if the people module put one into car.driver, is that module's to pull out BEFORE calling this
   *  — the 'drive:take' event tells it). A parked fleet car is simply entered. → Promise<fleet record | null> */
  async takeCar(car, { enter = true } = {}) {
    const c = this._findCar(car); if (!c) return null;
    if (c.path != null && 'v0' in c) { this._emitDrive('drive:take', { car: c, driver: c.driver || null }); return this.takeTrafficCar(c, { enter }); }
    this._emitDrive('drive:take', { car: c, driver: c.driver || null });
    if (enter && !this.drive) await this._enterCar(c, { gesture: false });
    return c;
  },
  /** Seats of a car in ITS frame (+z forward, +x the driver's side = left; y above the ground) and where the doors are:
   *  → { driver: {x, y, z}, passenger: {x, y, z}, rear: [{x, y, z} × 2], doorDriver: {x, z}, doorPassenger: {x, z}, eye: {x, y, z}, toWorld(p) → {x, y, z} } */
  carSeats(car) {
    const c = this._findCar(car); if (!c) return null;
    const S = this.mods.cars.carSpec(c.kind), sx = S.driverX ?? 0.37, sz = S.seatZ ?? S.seat ?? -0.1, sy = (S.cushion ?? 0.3) + 0.08, rz = sz - Math.min(0.95, S.wb * 0.32);
    const co = Math.cos(c.yaw), si = Math.sin(c.yaw), toWorld = p => ({ x: c.x + p.x * co + p.z * si, y: (c.y || 0) + (p.y || 0), z: c.z - p.x * si + p.z * co });
    return { driver: { x: sx, y: sy, z: sz }, passenger: { x: -sx, y: sy, z: sz }, rear: S.kind === 'super' || S.kind === 'cabrio' || S.kind === 'gt' ? [] : [{ x: sx, y: sy, z: rz }, { x: -sx, y: sy, z: rz }],
      doorDriver: { x: S.W / 2 + 0.55, y: 0, z: sz - 0.2 }, doorPassenger: { x: -(S.W / 2 + 0.55), y: 0, z: sz - 0.2 }, eye: { x: sx, y: S.eye ?? 1.15, z: sz }, toWorld };
  },
  /** Footprint of any car now: four world corners [[x, z] × 4] (front-left, front-right, rear-right, rear-left order of cars.js carCorners) + height. */
  carBox(car) { const c = car && car.car ? car : this._findCar(car); if (!c) return null; const r = this.drive && (c === this.drive.rec) ? this.drive.ctl : c; const S = this.mods.cars.carSpec(c.kind); return { corners: this.mods.cars.carCorners(S.kind, r.x, r.z, r.yaw, 0), y: r.y || 0, h: S.H, x: r.x, z: r.z, yaw: r.yaw }; },
  /** Damage from outside (the police ramming, a falling thing): damageCar(car, { point: [x, y, z] world, dir: [dx, dz] world push, speed m/s }). → the result of car-damage.js addImpact */
  damageCar(car, { point = null, dir = null, speed = 5, scrape = false } = {}) { const c = this._findCar(car); if (!c || c.path != null) return null; return this._damageRec(c, point || [c.x, (c.y || 0) + 0.5, c.z], dir, speed, scrape); },
  /** As new again (also revives a wrecked car). */
  repairCar(car) { const c = this._findCar(car); if (!c) return false; c.dmg = null; SESSION_DMG.delete(c.id); c.disabled = false; c.hazard = false; if (this.drive && this.drive.rec === c) { Object.assign(this.drive.ctl.mod, damageMods(null)); this.drive.ctl.disabled = false; this.drive.dmg = null; if (this.drive.ind === 2) this.drive.ind = 0; applyDamage(this.drive.car, null); this._renderDriveHud(true); } return true; },

  // ======================= crashes: damage, pushed cars, alarms, smoke =======================
  // world point + world push direction → the car's own frame → the damage record of the fleet record (created on first need)
  _damageRec(rec, point, dir, speed, scrape) {
    const S = this.mods.cars.carSpec(rec.kind), live = this.drive && this.drive.rec === rec ? this.drive.ctl : rec;
    const c = Math.cos(live.yaw), s = Math.sin(live.yaw), dx = point[0] - live.x, dz = point[2] - live.z;
    const d = rec.dmg || (rec.dmg = SESSION_DMG.get(rec.id) || newDamage());
    const res = addImpact(d, S, { point: [dx * c - dz * s, point[1] - (live.y || 0), dx * s + dz * c], dir: dir ? [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c] : null, speed, scrape });
    SESSION_DMG.set(rec.id, d); (this._dmgRecs || (this._dmgRecs = new Set())).add(rec);
    if (d.dead) { rec.disabled = true; rec.hazard = true; }
    return res;
  },
  // a parked (or crashed) car gets a shove: world velocity change (m/s) and a spin (rad/s); it slides to rest against its brakes
  _pushCar(rec, vx, vz, spin = 0) {
    if (!rec || !rec.collider || (this.drive && this.drive.rec === rec)) return null;
    const P = this._pushed || (this._pushed = new Map()); let pc = P.get(rec);
    if (!pc) { pc = new this.mods.cars.CarController(rec); pc.passive = true; P.set(rec, pc); }
    const crs = pc.yaw - pc.beta, wx = Math.sin(crs) * pc.v + vx, wz = Math.cos(crs) * pc.v + vz, sp = Math.hypot(wx, wz);
    pc.v = Math.min(sp, 40); pc.beta = sp > 0.05 ? wrapPi(pc.yaw - Math.atan2(wx, wz)) : 0; pc.yawKick = clamp(pc.yawKick + spin, -2.5, 2.5);
    return pc;
  },
  // a moving traffic car that was hit hard leaves the traffic: it becomes a (damaged) fleet car where it stands
  _crashTraffic(tc) {
    const tr = this._trafficRef(); if (!tr || !tr.take || !this.fleet) return null;
    const p = tr.take(tc); if (!p) return null;
    const rec = this.fleet.addOne({ ...p, src: 'crashed' }); rec.hazard = true; rec.driver = p.driver || null; rec.wasTraffic = true;
    this._registerCars(); this.fleet.markDirty();
    return rec;
  },
  _alarm(rec, now = performance.now()) {
    if (rec.driver || rec.wasTraffic || rec.src === 'taken') return;                // somebody sits in it: no alarm
    rec.alarmUntil = now + 7000; (this._dmgRecs || (this._dmgRecs = new Set())).add(rec);
    const A = this._carAudio(), cam = this.camera.position; if (A) A.alarm(7, clamp(1.4 - Math.hypot(rec.x - cam.x, rec.z - cam.z) / 40, 0.1, 1));
    this._emitDrive('drive:alarm', { car: rec });
  },
  // the visitor's car touched something this frame (I = CarController.impact)
  _carImpact(D, I, now) {
    const { ctl, rec, car } = D, C = this.mods.cars, S = ctl.S;
    if (!(I.speed > 0.7)) return;
    let other = I.other, orec = null, speed = I.speed, tc = null;
    const fx = Math.sin(I.course), fz = Math.cos(I.course), sgn = I.dir || 1, px = fx * sgn, pz = fz * sgn;   // world direction of travel at the contact
    if (other && typeof other === 'object' && !other.building) { if (other.path != null && 'v0' in other) tc = other; else if (other.collider) orec = other; }
    if (tc) {
      // closing speed with a moving car; a real blow takes it out of the traffic, a touch only shoves it along its lane
      const rel = Math.max(0.3, 1 - (tc.vx * px + tc.vz * pz) / Math.max(1, I.before)); speed = I.speed * Math.min(1.8, rel);
      if (I.hard && speed > 3.2) orec = this._crashTraffic(tc); else { this.addCarImpulse(tc, px * speed * 0.4, pz * speed * 0.4); }
      other = orec || tc;
    }
    if (orec) {
      const So = C.carSpec(orec.kind), mp = carMass(S), mo = carMass(So), share = mp / (mp + mo), vHit = I.hard ? I.before : speed;
      // both cars leave the contact with (nearly) the common speed; the car that was hit a little faster, so that they part
      const vc = vHit * share;
      if (I.hard) ctl.v = sgn * vc * 0.72;
      const side = (orec.x - ctl.x) * fz - (orec.z - ctl.z) * fx;                       // off-centre hits spin the other car
      this._pushCar(orec, px * vc * 1.22, pz * vc * 1.22, clamp(side * vHit * 0.05, -1.6, 1.6) * (I.hard ? 1 : 0.4));
      const sOther = vHit * share * 1.25, r2 = this._damageRec(orec, I.point, [px, pz], sOther, !I.hard);
      if (!orec.driver && sOther > 1.2) this._alarm(orec, now);
      speed = vHit * (1 - share) * 1.25;                                                // a car gives way: softer than a wall
      void r2;
    }
    const before = damageLevel(rec.dmg);
    const res = this._damageRec(rec, I.point, I.normal, speed, !I.hard);
    D.dmg = rec.dmg; Object.assign(ctl.mod, damageMods(rec.dmg, S));
    if (!I.hard) { D.scrape = Math.min(1, (D.scrape || 0) + 0.5 + speed * 0.05); if (this._carFx && speed > 2) this._carFx.sparks(I.point[0], I.point[1], I.point[2], Math.min(14, 3 + Math.round(speed)), [px * Math.abs(ctl.v), 0, pz * Math.abs(ctl.v)]); }
    else if (this._carFx && speed > 6) this._carFx.sparks(I.point[0], I.point[1], I.point[2], Math.min(24, Math.round(speed)), [0, 0, 0]);
    // the look (at most a few times per second: bending ≈ 100 000 vertices takes a moment)
    if (now - (D.bendT || 0) > 180 || res.died || res.level > before) { D.bendT = now; try { applyDamage(car, rec.dmg); } catch (e) { console.warn('[drive] damage look', e); } } else D.bendDue = true;
    const A = this._carAudio(); if (A && now - (D.sndT || 0) > 90) { D.sndT = now; A.impact(Math.max(speed, I.hard ? 2 : 1), { glass: res.glass, metal: res.kmh > 14 }); }
    if (navigator.vibrate && speed > 2) try { navigator.vibrate(speed > 8 ? 120 : 35); } catch { /* optional */ }
    if (res.died) { ctl.disabled = true; rec.disabled = true; D.ind = 2; D.indT = now; this._toast(this.t('walk.car.wrecked'), 6000); if (this._eng) this._engineStop(); this._renderDriveHud(true); }
    else if (res.level > before && res.level >= 2) this._toast(this.t('walk.car.dmg' + Math.min(4, res.level)), 2200);
    const mass = carMass(S), detail = { car: rec, speed, speedKmh: speed * 3.6, impulse: speed * mass, hard: !!I.hard, point: I.point, normal: I.normal, other, zone: res.zone, level: res.level, levelName: DAMAGE_LEVELS[res.level], wrecked: !!rec.dmg.dead, pos: { x: ctl.x, y: ctl.y, z: ctl.z } };
    this._emitDrive('drive:impact', detail); this._emitDrive('drive:collision', detail);
    if (res.died) this._emitDrive('drive:wrecked', { car: rec });
  },
  // every frame, driving or on foot: cars sliding after a shove, alarms and hazard lights, smoke and sparks, the look of damaged cars nearby
  _carsTick(dt) {
    if (!this.fleet || !(dt > 0)) return;
    const now = performance.now(), cam = this.camera.position;
    if (this._pushed && this._pushed.size) {
      const world = this._driveWorld();
      for (const [rec, pc] of this._pushed) {
        pc.impact = null; const n = Math.min(4, Math.max(1, Math.ceil(dt * 60))); for (let i = 0; i < n; i++) pc.step(dt / n, {}, world);
        Object.assign(rec, { x: pc.x, y: pc.y, z: pc.z, yaw: pc.yaw, pitch: pc.pitch });
        this.fleet.moved(rec); for (const e of this.solids) if (e.o === rec.collider) e.box = null;
        if (pc.impact && pc.impact.speed > 1.5) { const I = pc.impact; this._damageRec(rec, I.point, I.normal, I.speed, !I.hard); const A = this._carAudio(); if (A) A.impact(I.speed, { gain: clamp(1.3 - Math.hypot(rec.x - cam.x, rec.z - cam.z) / 30, 0.15, 1) }); const o = I.other; if (o && o.collider && o !== rec && I.speed > 2.5) { const cx = Math.sin(I.course), cz = Math.cos(I.course); this._pushCar(o, cx * I.speed * 0.5, cz * I.speed * 0.5); this._damageRec(o, I.point, [cx, cz], I.speed * 0.6, !I.hard); this._alarm(o, now); } }
        if (Math.abs(pc.v) < 0.06 && Math.abs(pc.yawKick) < 0.02) { this._pushed.delete(rec); this._trafficObstacles(true); }
      }
    }
    const fx = this._carFx; let smoking = false;
    if (this._dmgRecs && this._dmgRecs.size) {
      const blink = Math.floor(now / 380) % 2 === 0, drv = this.drive ? this.drive.rec : null;
      for (const rec of this._dmgRecs) {
        const d = rec.dmg, live = rec === drv ? this.drive.ctl : rec, dist = Math.hypot(live.x - cam.x, live.z - cam.z);
        // smoke from the engine bay: steam when it is hurt, dark smoke when it is wrecked
        if (d && d.engine > 0.5 && dist < 90 && Math.abs((live.y || 0) - cam.y) < 12) {
          smoking = true; const S = this.mods.cars.carSpec(rec.kind), rear = S.kind === 'super', lz = rear ? S.zR + 0.75 : S.zF - 0.85, co = Math.cos(live.yaw), si = Math.sin(live.yaw);
          rec._smk = (rec._smk || 0) + dt * (d.dead ? 16 : d.engine > 0.8 ? 10 : 5);
          if (!this._carFx) { try { this._carFx = createCarFx(); this.scene.add(this._carFx.group); } catch (e) { console.warn('[drive] fx', e); this._carFx = null; rec._smk = 0; } }
          while (rec._smk >= 1 && this._carFx) { rec._smk -= 1; this._carFx.smoke(live.x + lz * si, (live.y || 0) + S.H * (rear ? 0.62 : 0.56), live.z + lz * co, d.dead || d.engine > 0.8 ? 'smoke' : 'steam', 1); }
        }
        // alarm / hazard lights (seen on the detailed model only)
        if (rec !== drv) {
          const car = this.fleet.carOf(rec), on = (rec.alarmUntil && now < rec.alarmUntil) || rec.hazard;
          if (car && (on || rec._blinking)) { car.setLights(false, false, false, on && blink); rec._blinking = on; }
          if (rec.alarmUntil && now >= rec.alarmUntil) rec.alarmUntil = 0;
        }
        if (!d && !rec.alarmUntil && !rec.hazard) this._dmgRecs.delete(rec);
      }
    }
    if (this._carFx && (smoking || this._carFx.live > 0 || this._fxWas)) { const k = this.envMode === 'night' ? 0.25 : this.envMode === 'dusk' ? 0.55 : 1; this._fxWas = this._carFx.update(dt, cam.y < -1 ? 0.5 : k, this.renderer.domElement.height / (2 * Math.tan(this.camera.fov * Math.PI / 360))) > 0; }
    // the look of damaged cars that have their detailed model now (one car per frame)
    if (this.fleet.active) for (const rec of this.fleet.active) {
      if (!rec.dmg) { const sd = SESSION_DMG.get(rec.id); if (sd) { rec.dmg = sd; if (sd.dead) { rec.disabled = true; rec.hazard = true; } (this._dmgRecs || (this._dmgRecs = new Set())).add(rec); } }
      const car = this.fleet.carOf(rec), want = rec.dmg ? rec.dmg.rev : 0; if (!car || (car.damageRev || 0) === want) continue;
      if (this.drive && this.drive.rec === rec && !this.drive.bendDue && now - (this.drive.bendT || 0) < 180) continue;
      try { applyDamage(car, rec.dmg); } catch (e) { console.warn('[drive] damage look', e); car.damageRev = want; }
      if (this.drive && this.drive.rec === rec) { this.drive.bendDue = false; this.drive.bendT = now; }
      break;
    }
  },
  _driveDispose() { try { if (this._carFx) this._carFx.dispose(); } catch { /* */ } this._carFx = null; this._pushed = null; this._dmgRecs = null; try { if (this._carA) this._carA.dispose(); } catch { /* */ } this._carA = null; this._eng = null; },

  /** The same hooks as one object with on / off (what an adapter of another module expects): walk.driveHooks() */
  driveHooks() {
    return this._dapi || (this._dapi = { on: (t, cb) => this.onDrive(t, cb), off: (t, cb) => this.offDrive(t, cb), getPlayerCar: () => this.getPlayerCar(), forEachTrafficCar: cb => this.forEachTrafficCar(cb),
      takeTrafficCar: (c, o) => this.takeTrafficCar(c, o), setCarDisabled: (c, on) => this.setCarDisabled(c, on), addCarImpulse: (c, a, b) => this.addCarImpulse(c, a, b), openCarDoor: (c, on) => this.openCarDoor(c, on),
      forEachParkedCar: cb => { if (this.fleet) for (const r of this.fleet.records) if (!this.drive || r !== this.drive.rec) cb(r); }, carSpec: k => this.mods.cars.carSpec(k),
      takeCar: (c, o) => this.takeCar(c, o), stopCar: (c, on) => this.stopCar(c, on), carSeats: c => this.carSeats(c), carBox: c => this.carBox(c), damageCar: (c, o) => this.damageCar(c, o), repairCar: c => this.repairCar(c),
      enterCar: (c, o) => this._enterCar(this._findCar(c), { gesture: false, ...o }), exitCar: () => this._exitCar(), isDriving: () => !!this.drive, STATIONS: null });
  },

  // ======================= the extended city (V8-city), when it is there =======================
  // environment.js may carry env.city (the real Uzhhorod around the plot). Then its data module answers where the roads,
  // the houses and the edge of the map are; without it the streets of data.js (cars.js drive area) are all there is.
  _cityStart() {
    try {
      const ec = this.env && this.env.city; if (!ec) return;
      if (typeof ec.enable === 'function') Promise.resolve(ec.enable()).catch(() => {});
      if (!this._cityP) this._cityP = import('./city-data.js').then(m => { this._cityMod = m; return m.loadCity ? m.loadCity() : null; }).catch(() => { this._cityMod = null; });
    } catch { /* optional */ }
  },
  _city() { const m = this._cityMod; return m && m.CITY && m.CITY.ready ? m : null; },
  // outside the hand-built surroundings of the plot the city's own data rules
  _cityOut(M, x, z) { const s = M.CITY.seam; return !s || x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1; },

  // ======================= entering / leaving =======================
  _showCarChip(rec, ms = 7000) {
    if (this._chipRec && this._chipRec !== rec) this._carOpsReset(this._chipRec);
    this._chipRec = rec; this.el.carChip.classList.add('show');
    if (this.el.carOps) { this.el.carOps.classList.add('show'); for (const [k, key] of [['cardoor', 'walk.car.door'], ['carhorn', 'walk.car.horn'], ['carflash', 'walk.car.lights']]) { const b = this.el.carOps.querySelector(`[data-k=${k}]`); if (b) { b.title = this.t(key); b.setAttribute('aria-label', this.t(key)); } } }
    const S = this.mods.cars.carSpec(rec.kind), lbl = this.el.carChip.querySelector('.lbl');
    if (lbl) lbl.textContent = this.t('walk.car.enter') + (S.name ? ' · ' + S.name : '');
    clearTimeout(this._chipT); if (ms) this._chipT = setTimeout(() => { if (!this._chipNear) this._hideCarChip(); }, ms);
  },
  // V19: a parked car seen on foot — its door opens / closes, the horn sounds, the headlights go on / off (detailed model, ≤ 24 m)
  _carOp(k) {
    const rec = this._chipRec; if (!rec || !this.fleet || this.drive) return;
    this._showCarChip(rec);
    const car = this.fleet.carOf(rec); rec._ops = rec._ops || { door: 0, lights: false };
    if (k === 'cardoor') { const to = rec._ops.door > 0.5 ? 0 : 1, from = rec._ops.door; rec._ops.door = to; this._click?.(0.4); return this._doorSwing(car, from, to, 420); }
    if (k === 'carhorn') { const A = this._carAudio(); if (A) { try { A.horn(true, this.mods.cars.carSpec(rec.kind)); setTimeout(() => { try { A.horn(false); } catch { /* */ } }, 420); } catch { /* */ } } this._emitDrive && this._emitDrive('drive:horn', { car: rec, on: true }); if (this.people && this.people.hornAt) try { this.people.hornAt({ x: rec.x, z: rec.z }); } catch { /* */ } return; }
    if (k === 'carflash') { rec._ops.lights = !rec._ops.lights; if (car && car.setLights) car.setLights(rec._ops.lights); return; }
  },
  _carOpsReset(rec) {
    if (!rec || !rec._ops) return;
    const car = this.fleet && this.fleet.carOf(rec);
    if (car) { if (rec._ops.door > 0) this._doorSwing(car, rec._ops.door, 0, 380); if (rec._ops.lights && car.setLights) car.setLights(false); }
    rec._ops = null;
  },
  async _doorSwing(car, from, to, ms) {
    if (!car || !car.setDoor) return;
    const t0 = performance.now();
    for (;;) { const t = clamp((performance.now() - t0) / ms); car.setDoor(lerpN(from, to, sstep(t))); if (t >= 1 || this.disposed) break; await frame(); }
  },
  async _enterCar(rec = this._chipRec, { gesture = true } = {}) {
    if (!rec || !this.fleet || this.drive || this.riding || this.busy) return;
    if (gesture && this._gameNotice && this._gameNotice(() => this._enterCar(rec, { gesture: true }))) return;   // V9: first drive → the game-mode notice
    if (rec._ops) { rec._ops = null; }                                  // V19: door / lights set from outside are taken over by the drive
    this.busy = true; this._hideCarChip();
    // FIRST, still inside the tap / key press that got us here: the radio and the audio context (browsers demand a gesture)
    if (gesture) { this._radioStart(); this._carAudio(); if (this._gameAudioResume) this._gameAudioResume(); }
    this._cityStart();
    try {
      this._driveHudInit();
      this.fleet.setFocus(rec); this.fleet.update(this.camera, true);
      const car = this.fleet.carOf(rec);
      if (!car) { this._radioStop(); return; }
      await this._doorSwing(car, 0, 1, 380);
      await this._fade(true);
      const ctl = new this.mods.cars.CarController(rec);
      if (!rec.dmg && SESSION_DMG.has(rec.id)) rec.dmg = SESSION_DMG.get(rec.id);
      if (rec.dmg) { Object.assign(ctl.mod, damageMods(rec.dmg, ctl.S)); if (rec.dmg.dead) ctl.disabled = true; if ((car.damageRev || 0) !== rec.dmg.rev) { try { applyDamage(car, rec.dmg); } catch { /* look only */ } } }
      rec.alarmUntil = 0; rec.hazard = false; if (this._carA) this._carA.alarmStop();
      this._fovWalk = this.camera.fov;
      this.drive = { rec, car, ctl, view: lsGet('vrc.walk.carView') === 'chase' ? 'chase' : 'fp', look: { yaw: 0, pitch: 0 }, pad: { gas: 0, brake: 0, steer: 0 }, cam: null, lights: null,
        gear: 'D', manual: false, dmg: rec.dmg || null, start: { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw }, trail: [], trailT: 0, rHold: null, turn: null, horn: 0, tilt: 0, obsT: 0, blinkT: 0,
        ind: 0, indT: 0, indSteer: 0, wipers: false, wipT: 0, tickT: 0, frame: 0, mirror: null, hudT: 0 };
      this.glide = null; this.player.vel.set(0, 0, 0); this.keys.clear();
      car.setInside(this.drive.view === 'fp'); car.ensureCockpit && car.ensureCockpit(); if (car.cockpit) car.cockpit.group.visible = true;
      this._mirrorInit(this.drive);
      this.root.classList.add('driving'); this.root.classList.toggle('drive-fp', this.drive.view === 'fp');
      this._renderDriveHud(true);
      if (!this._carMuted() && !ctl.disabled) this._engineStart(rec.kind);                    // engine sound is on by default, quietly; the HUD button mutes everything
      this._driveUpdate(0);
      this._doorSwing(car, 1, 0, 320).then(() => { const A = this._carA; if (A && this.drive) A.door(); });
      if (!this._driveHinted && this._isTouch) { this._driveHinted = true; this._toast(this.t('walk.car.hintTouch'), 6000); }   // desktop: the key list stands in the corner
      this._emitDrive('drive:enter', { car: rec });
      if (this._gameStart) { this._gameHudInit(); this._gameStart(); }   // V9: people + police once the city data is there
    } finally { this.busy = false; await this._fade(false); }
  },
  async _exitCar() {
    const D = this.drive; if (!D || this.busy) return;
    if (Math.abs(D.ctl.v) > 1.6) { this._toast(this.t('walk.car.stopFirst'), 1800); return; }
    this.busy = true;
    try {
      const { rec, car, ctl } = D, S = ctl.S;
      ctl.v = 0;
      // where to stand: beside the driver's door, else the other side, else behind / in front
      const c = Math.cos(ctl.yaw), s = Math.sin(ctl.yaw), toW = (lx, lz) => [ctl.x + lx * c + lz * s, ctl.z - lx * s + lz * c];
      const spots = [[S.W / 2 + 0.6, S.seat - 0.25], [-(S.W / 2 + 0.6), S.seat - 0.25], [0, S.zR - 0.8], [0, S.zF + 0.8], [S.W / 2 + 1.2, S.seat]];
      let pos = null, side = 0;
      for (let i = 0; i < spots.length; i++) {
        const [x, z] = toW(spots[i][0], spots[i][1]);
        const fy = this._floorAt(x, ctl.y + 0.3, z, this._near(this.floors, new THREE.Vector3(x, ctl.y, z), 2));
        if (fy == null || Math.abs(fy - ctl.y) > 0.6) continue;
        if (!this._isFree(x, fy, z)) continue;
        // beside the car: there must be a way out of the gap, forwards or backwards (a neighbour may stand 40 cm away)
        if (i < 2) { const lx = spots[i][0], run = (z0, z1) => { for (let lz = z0, n = 0; n < 14; n++, lz += Math.sign(z1 - z0) * 0.4) { const [qx, qz] = toW(lx, lz); if (!this._isFree(qx, fy, qz)) return false; if ((z1 - lz) * Math.sign(z1 - z0) <= 0) break; } return true; };
          if (!run(spots[i][1], S.zF + 0.7) && !run(spots[i][1], S.zR - 0.7)) continue; }
        pos = new THREE.Vector3(x, fy, z); side = i; break;
      }
      if (side === 0) await this._doorSwing(car, 0, 1, 300);
      await this._fade(true);
      Object.assign(rec, { x: ctl.x, y: ctl.y, z: ctl.z, yaw: ctl.yaw, pitch: ctl.pitch, roll: 0 });
      if (rec.dmg && rec.dmg.dead) rec.hazard = true;
      this._radioStop(); this._carSoundsStop();
      car.setInside(false); car.setLights(false); car.setWheels(ctl.spin, 0); if (this.headSpot) this.headSpot.intensity = 0;
      if (car.cockpit) { car.cockpit.setWipers(0); car.cockpit.setMirrorMap(null); car.cockpit.group.visible = false; }
      this._mirrorDispose(D);
      car.group.position.set(ctl.x, ctl.y, ctl.z); car.group.rotation.set(-ctl.pitch, ctl.yaw, 0, 'YXZ'); car.group.updateMatrixWorld(true);
      this.fleet.setFocus(null); this.fleet.moved(rec);
      for (const e of this.solids) if (e.o === rec.collider) e.box = null;
      this.drive = null;
      this._driveViewport(0); this._paniniSet(null);
      this.root.classList.remove('driving', 'tilt', 'drive-fp', 'dmenu-open');
      this._tiltStop();
      this._applyFov();
      this._trafficObstacles(true);
      if (!pos) { const [x, z] = toW(S.W / 2 + 0.6, S.seat); const [fx, fz] = this._freeSpot(x, ctl.y, z, 3); pos = new THREE.Vector3(fx, ctl.y, fz); }
      // look back at the car just left
      this._place(pos, Math.atan2(ctl.x - pos.x, ctl.z - pos.z) + Math.PI + (side === 0 ? 0.35 : 0));
      this.player.eye = EYE;
      this._lastPlace = null; this._updateHud(true);
      if (side === 0) this._doorSwing(car, 1, 0, 420);
      else car.setDoor && car.setDoor(0);
      this._emitDrive('drive:exit', { car: rec });
    } finally { this.busy = false; await this._fade(false); }
  },
  // headlights: automatic (dusk / night / underground) until toggled
  _toggleHeadlights() { const D = this.drive; if (!D) return; D.lights = !this._lightsOn(D); this._renderDriveHud(true); },
  _lightsOn(D = this.drive) { return D ? (D.lights != null ? D.lights : this.envMode !== 'day' || D.ctl.y < -0.8) : false; },
  // the sound button (and M): everything of the car — engine, tyres, wind, horn, radio — off / on
  _carMuted() { return lsGet('vrc.walk.carSound') === 'off'; },
  _toggleCarSound() {
    const D = this.drive; if (!D) return;
    const mute = !this._carMuted();
    lsSet('vrc.walk.carSound', mute ? 'off' : 'on');
    const A = this._carAudio(); if (A) A.setMuted(mute);
    if (this._radio) this._radio.setMuted(mute);
    if (!mute && !this._eng) this._engineStart(D.rec.kind);
    this._renderDriveHud(true);
  },
  _toggleCarView() {
    const D = this.drive; if (!D) return;
    D.view = D.view === 'fp' ? 'chase' : 'fp'; D.cam = null; D.look.yaw = D.look.pitch = 0;
    D.car.setInside(D.view === 'fp'); if (D.car.cockpit) D.car.cockpit.group.visible = true; lsSet('vrc.walk.carView', D.view); this.root.classList.toggle('drive-fp', D.view === 'fp');
    this._renderDriveHud(true);
  },
  // V10: frame the driver's view on the glass — the windscreen's four corners and the front half of both side windows must be in
  // the picture on any screen shape. Seen from the driver's real head point those span ≈ 100–125° across. A plain (rectilinear)
  // lens that wide stretches the edges and shrinks the road; so the picture goes through a Panini projection (d = 1, as in game
  // engines' wide-angle modes): verticals stay straight, the middle keeps its natural size, the sides are compressed — the road
  // ahead is ≈ 1.5 × larger than with a plain lens of the same width. ?panini=0 switches it off (plain off-centre lens).
  // The key points are mapped into that projection at the resting gaze (FP_YAW / FP_PITCH); the frame = their extent + a margin,
  // widened to the screen's shape, off-centre (lens shift) instead of turning the head further.
  // Landscape / desktop: the whole screen; the spare height goes 30 % above the glass, 70 % below (dashboard).
  // Portrait (a phone held upright): that width would need ≈ 150° vertically — a fish-eye of seat cushions and headliner. Instead
  // the 3D picture is a band at the top at a sane vertical angle (≤ FP_VMAX), from just above the glass (room for the title card)
  // into the dashboard, and the rest of the screen is the control deck — none of the controls lies over the glass.
  // Returns { deck (px), out: frame in projection units, src: the rectangle the camera renders, eye }. Cached per car + screen.
  _fpFrame(D, W, H) {
    const car = D.car, pan = this._paniniOK(), aspect = W / Math.max(1, H), key = W + 'x' + H + (pan ? 'p' : 'r');
    if (D.fpf && D.fpf.key === key) return D.fpf;
    const S = car.spec, eye = (car.head || car.eye).clone(); { const rw = S.gh && S.gh.roofW; if (rw) eye.x = Math.min(eye.x, rw - 0.22); }   // under a narrow roof the head is nearer the middle
    // V19 (owner): the driver sees the whole bonnet and the instruments — the seat goes up (per car, ≤ 12 cm, under the roof)
    // until the line of sight to the bonnet just ahead of the windscreen clears the instrument binnacle and the dash top;
    // the bonnet's front edge and the instrument cluster join the glass in the points the view is framed on
    const hk = fpHoodKeys(S, eye, car); eye.y += hk.raise;
    const K = car.glassKeys ? car.glassKeys(eye) : { screen: [], sides: [] }, pts = [...K.screen, ...K.sides.flat(), ...hk.pts];
    const o = new THREE.Object3D(); o.position.copy(eye); o.rotation.set(FP_PITCH, Math.PI + FP_YAW, 0, 'YXZ'); o.updateMatrixWorld(true);
    const inv = o.matrixWorld.clone().invert(), q = new THREE.Vector3();
    let u0 = -0.9, u1 = 0.9, v0 = -0.3, v1 = 0.35;                       // fallback (no glass found): a plain wide view
    if (pts.length) { u0 = v0 = Infinity; u1 = v1 = -Infinity; for (const p of pts) { q.copy(p).applyMatrix4(inv); const [u, v] = fpProj(q.x, q.y, q.z, pan); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } }
    const pu = 0.05 + 0.02 * (u1 - u0), pv = 0.05;
    u0 -= pu; u1 += pu; v0 -= pv; v1 += pv;
    const Wu = u1 - u0, Hv = v1 - v0;
    let deck = 0, Wf, Hf, vTop;
    if (aspect < FP_DECK_ASPECT) {
      Wf = Wu; const px = W / Wf;                                        // px per projection unit across
      const top = FP_DECK_TOP / px, HfMax = 2 * Math.tan(FP_VMAX / 2 * Math.PI / 180), need = Hv + top + (hk.pts.length ? 0.08 : 0.3);   // + a strip of dashboard (V19: the instruments are among the key points already)
      Hf = Math.min(HfMax, Math.max(need, H * FP_BAND_MIN / px));
      const band = Math.round(Math.min(H - FP_DECK_MIN, Hf * px)); Hf = band / px; deck = H - band;
      // spare height: half above the glass (headliner, mirror — or sky in an open car), half below (dashboard, wheel)
      const spare = Hf - need; vTop = spare >= 0 ? v1 + top + 0.5 * spare : v1 + Math.max(0, top + spare);
    } else {
      const v0d = Math.min(v0, -0.42), Hvd = v1 - v0d;                    // always a little of the bonnet / dashboard top: the car is felt
      const topF = Math.min(0.2, FP_TOP_UI / H);                          // the title card stays off the glass
      Wf = Math.max(Wu, aspect * Hvd / (1 - topF)); Hf = Wf / aspect;
      vTop = v1 + Math.max(topF * Hf, (Hf - Hvd) * 0.3);
    }
    // horizontal slack (wide screens): move the centre towards straight ahead
    const ex = (Wf - Wu) / 2, uc = clamp(0, (u0 + u1) / 2 - ex, (u0 + u1) / 2 + ex), vc = vTop - Hf / 2;
    const out = { uc, vc, W: Wf, H: Hf };
    // the rectangle the camera must render: the output's border mapped back to a plain lens (the inverse is monotonic: the border
    // holds the extremes)
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (let k = 0; k <= 24; k++) { const f = k / 24 - 0.5;
      for (const [xp, yp] of [[uc + f * Wf, vc - Hf / 2], [uc + f * Wf, vc + Hf / 2], [uc - Wf / 2, vc + f * Hf], [uc + Wf / 2, vc + f * Hf]]) {
        const [u, v] = fpInv(xp, yp, pan); s0 = Math.min(s0, u); s1 = Math.max(s1, u); t0 = Math.min(t0, v); t1 = Math.max(t1, v); } }
    const Ws = s1 - s0, Hs = t1 - t0, suc = (s0 + s1) / 2, svc = (t0 + t1) / 2;
    const src = { uc: suc, vc: svc, W: Ws, H: Hs, aspect: Ws / Hs, fov: 2 * Math.atan(Hs / 2) * 180 / Math.PI, sx: 2 * suc / Ws, sy: 2 * svc / Hs };
    D.fpf = { key, eye, deck, pan, out, src, hood: hk, hfov: 2 * Math.atan(pan ? Math.tan(2 * Math.atan(Wf / 4)) : Wf / 2) * 180 / Math.PI };
    return D.fpf;
  },
  _paniniOK() {
    if (this._panOK == null) { let off = false; try { off = /[?&]panini=0\b/.test(location.search); } catch { /* */ } this._panOK = !off && !!this.renderer.capabilities; }
    return this._panOK;
  },
  // V10: the Panini pass. The main render (walk.js loop → renderer.render(scene, camera)) is redirected into a render target by
  // scene.onBeforeRender, and scene.onAfterRender draws it onto the screen band through the projection. The target is flagged as
  // an "XR" target so three.js tone-maps and sRGB-encodes into it exactly as for the screen (same shader programs, no recompiles).
  _paniniSet(fr) {
    let P = this._pan;
    const on = !!(fr && fr.pan);
    if (!on) { if (P) { this.scene.onBeforeRender = NOOP; this.scene.onAfterRender = NOOP; P.rt.dispose(); P.mat.dispose(); P.geo.dispose(); this._pan = null; } return; }
    const r = this.renderer;
    if (!P) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { samples: r.capabilities.isWebGL2 ? 4 : 0, depthBuffer: true });
      rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.internalFormat = 'RGBA8'; rt.isXRRenderTarget = true;
      const geo = new THREE.PlaneGeometry(2, 2);
      const mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
        uniforms: { tSrc: { value: rt.texture }, uOut: { value: new THREE.Vector4() }, uSrc: { value: new THREE.Vector4() } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D tSrc; uniform vec4 uOut, uSrc; varying vec2 vUv;
          void main(){ vec2 p = uOut.xy + (vUv - 0.5) * uOut.zw;            // Panini (d = 1) → direction → plain-lens coordinates
            float th = 2.0 * atan(p.x * 0.5), S = 2.0 / (1.0 + cos(th));
            vec2 q = vec2(tan(th), p.y / S / cos(th));
            gl_FragColor = texture2D(tSrc, (q - uSrc.xy) / uSrc.zw + 0.5); }` });
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
      const qs = new THREE.Scene(); qs.add(mesh);
      P = this._pan = { rt, geo, mat, qs, qc: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), deck: 0 };
      this.scene.onBeforeRender = (rr, sc, cam, T) => { const Q = this._pan; if (Q && cam === this.camera && !T) rr.setRenderTarget(Q.rt); };
      this.scene.onAfterRender = (rr, sc, cam) => { const Q = this._pan; if (!Q || cam !== this.camera || rr.getRenderTarget() !== Q.rt) return; rr.setRenderTarget(null); (this.__draw || rr.render.bind(rr))(Q.qs, Q.qc); };   // __draw: the test tools keep the real render() there while they stub it
    }
    const W = this.container.clientWidth || window.innerWidth, H = this.container.clientHeight || window.innerHeight, dpr = r.getPixelRatio();
    const ow = W * dpr, oh = (H - fr.deck) * dpr;
    // the source sharp enough in the middle (there the projection is 1 : 1), but at most 1.6 × the screen's pixels (phones 1.15 ×)
    let kx = fr.src.W / fr.out.W, ky = fr.src.H / fr.out.H; const k = Math.min(1, Math.sqrt((this._isTouch ? 1.15 : 1.6) / Math.max(1e-3, kx * ky))); kx *= k; ky *= k;
    const mx = r.capabilities.maxTextureSize || 4096, w = Math.min(mx, Math.max(16, Math.round(ow * kx))), h = Math.min(mx, Math.max(16, Math.round(oh * ky)));
    if (P.rt.width !== w || P.rt.height !== h) P.rt.setSize(w, h);
    P.mat.uniforms.uOut.value.set(fr.out.uc, fr.out.vc, fr.out.W, fr.out.H); P.mat.uniforms.uSrc.value.set(fr.src.uc, fr.src.vc, fr.src.W, fr.src.H);
    P.deck = fr.deck;
  },
  // V10: the 3D picture in a band at the top (portrait driver's view) or the whole canvas; the deck below is HTML (CSS var --deck)
  _driveViewport(deck) {
    const r = this.renderer, W = this.container.clientWidth || window.innerWidth, H = this.container.clientHeight || window.innerHeight;
    r.setViewport(0, deck, W, H - deck);                                 // three.js: (x, y) = lower-left corner; re-set every frame (setSize resets it)
    if (deck !== this._deckPx) {
      this._deckPx = deck; this.root.classList.toggle('drive-deck', deck > 0); this.root.style.setProperty('--deck', deck + 'px');
      if (!deck) { this.camera.aspect = W / Math.max(1, H); this.camera.updateProjectionMatrix(); }
    }
  },
  _toggleGear(g) {
    const D = this.drive; if (!D) return;
    if (Math.abs(D.ctl.v) > 0.8) { this._toast(this.t('walk.car.stopFirst'), 1400); return; }
    D.gear = g || (D.gear === 'D' ? 'R' : 'D'); D.manual = D.gear === 'R';
    this._renderDriveHud(true);
  },
  // indicators: −1 right, +1 left, 0 off (the same key again cancels; they cancel themselves after the turn); 2 = hazards
  _setIndicator(v) { const D = this.drive; if (!D) return; D.ind = D.ind === v ? 0 : v; D.indT = performance.now(); D.indSteer = 0; },
  _toggleWipers() { const D = this.drive; if (!D) return; D.wipers = !D.wipers; },
  // back to where the car last drove freely (R held, or the reset button): out of any corner it got wedged into
  async _resetCar() {
    const D = this.drive; if (!D || this.busy) return;
    this.busy = true;
    try {
      await this._fade(true);
      const now = performance.now(), ctl = D.ctl, rec0 = D.rec;
      const p = [...D.trail].reverse().find(q => now - q.t > 2500 && Math.hypot(q.x - ctl.x, q.z - ctl.z) > 2.5) || D.trail[0] || D.start;
      Object.assign(ctl, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, v: 0, steer: 0, pitch: p.pitch || 0, roll: 0, dive: 0, hit: 0, gear: 'D', _autoR: false, yawKick: 0, beta: 0 });
      const fresh = !!(rec0.dmg && rec0.dmg.dead); if (fresh) { this.repairCar(rec0); if (!this._carMuted()) this._engineStart(rec0.kind); }
      D.gear = 'D'; D.manual = false; D.cam = null; D.turn = null; D.trail = D.trail.filter(q => q.t <= p.t);
      this._driveUpdate(0);
      this._toast(this.t(fresh ? 'walk.car.fresh' : 'walk.car.reset'), fresh ? 3000 : 1800);
    } finally { this.busy = false; await this._fade(false); }
  },
  // keys while driving (called first by walk.js _onKey): true = handled
  _driveKey(ev, down, code) {
    const D = this.drive; if (!D) return false;
    if (code === 'KeyR') {
      if (ev.repeat) return true;
      if (down) D.rHold = performance.now();
      else D.rHold = null;                                  // (V19: no gear to toggle; R held = reset)
      return true;
    }
    if (code === 'KeyH') { if (!ev.repeat) { if (down) this._hornStart(); else this._hornStop(); } return true; }
    if (down && !ev.repeat && code === 'KeyE') { ev.preventDefault(); this._exitCar(); return true; }
    if (down && (code === 'Comma' || code === 'Period')) { if (!ev.repeat) this._radioCmd(code === 'Comma' ? 'prev' : 'next'); return true; }
    if (down && (code === 'Minus' || code === 'Equal' || code === 'NumpadSubtract' || code === 'NumpadAdd')) { this._radioCmd(code === 'Minus' || code === 'NumpadSubtract' ? 'down' : 'up'); return true; }
    if (down && !ev.repeat && code === 'KeyO') { this._radioCmd('power'); return true; }
    if (down && !ev.repeat && (code === 'KeyZ' || code === 'KeyX')) { this._setIndicator(code === 'KeyZ' ? 1 : -1); return true; }
    if (down && !ev.repeat && code === 'KeyG') { this._setIndicator(2); return true; }
    if (down && !ev.repeat && code === 'KeyP') { this._toggleWipers(); return true; }
    return false;
  },

  // ======================= the radio =======================
  _radioGet() {
    if (this._radio !== undefined) return this._radio;
    try {
      this._radio = createRadio(this.opts && this.opts.radio ? this.opts.radio : {});
      this._radio.onChange(st => { this._radioHud(); if (this.drive) this._emitDrive('drive:radio', { car: this.drive.rec, on: st.on, station: st.station, status: st.status }); });
    } catch (e) { console.warn('[drive] radio', e); this._radio = null; }
    return this._radio;
  },
  _radioStart() { const R = this._radioGet(); if (!R) return; try { R.setMuted(this._carMuted()); R.start(); } catch { /* never blocks the drive */ } },
  _radioStop() { const R = this._radio; if (R) { try { R.stop(false); } catch { /* */ } } this._radioHud(); },
  _radioCmd(c) {
    const R = this._radioGet(); if (!R || !this.drive) return;
    try {
      if (c === 'next') R.next(); else if (c === 'prev') R.prev(); else if (c === 'power') R.toggle();
      else if (c === 'up') R.volumeBy(0.1); else if (c === 'down') R.volumeBy(-0.1);
    } catch { /* */ }
    this._radioHud();
  },
  _radioHud() {
    const e = this.el, R = this._radio; if (!e || !e.dradio || !R) return;
    const st = R.state, s = st.station;
    e.dradio.classList.toggle('off', !st.on); e.dradio.classList.toggle('live', st.on && st.status === 'playing');
    e.dradioName.textContent = st.on && s ? s.name : this.t('walk.radio.off');
    e.dradioSub.textContent = !st.on ? this.t('walk.radio.title') : (s ? s.freq + ' · ' : '') + (st.status === 'playing' ? this.t('walk.radio.live') : st.status === 'error' ? this.t('walk.radio.none') : this.t('walk.radio.connecting'));
    e.dradio.querySelector('[data-kr=power]').classList.toggle('on', st.on);
    if (e.dradioBtn) { e.dradioBtn.classList.toggle('play', st.on && st.status === 'playing'); e.dradioBtn.title = e.dradioName.textContent; }
  },
  // V10: radio bar open / folded (null = the remembered choice, else folded on a phone, open on a computer)
  _radioBar(open) {
    if (open == null) { const v = lsGet('vrc.walk.radioBar'); open = v ? v === 'open' : !this._phone; } else lsSet('vrc.walk.radioBar', open ? 'open' : 'min');
    this.root.classList.toggle('radio-open', !!open);
    const b = this.el && this.el.dradioBtn; if (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.setAttribute('aria-label', this.t('walk.radio.title')); b.classList.toggle('on', !!open); }
  },

  // ======================= the physics world =======================
  _groundAt(x, y, z) {
    const o = this._v1.set(x, y + 0.9, z);
    const hits = this._cast(this._near(this.floors, o, 3), o, this._v2.set(0, -1, 0), 2.0);
    for (const h of hits) if (h.point.y <= y + 0.62) return h.point.y;
    // far out in the extended city there is no collider plane: the world is flat at y = 0 there
    if (Math.abs(y) < 0.7) { const M = this._city(); if (M && this._cityOut(M, x, z) && (!M.insideCity || M.insideCity(x, z))) return 0; }
    return null;
  },
  _carBlocked(ctl, x, z, yaw, y) {
    const S = ctl.S, hw = S.W / 2 + 0.02, zf = S.zF + 0.04, zr = S.zR - 0.04, zc = (zf + zr) / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw), W = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const [cx, cz] = W(0, zc), dirS = ctl.v >= 0 ? 1 : -1, nrm = [-s * dirS, -c * dirS];
    const con = (other, point) => { ctl.contact = { point: point || [x + s * (dirS > 0 ? zf : zr), y + 0.5, z + c * (dirS > 0 ? zf : zr)], normal: nrm, other }; return true; };
    // a car that is being shoved: the visitor's car is solid for it (when it would come closer), the visitor's stale parking collider is not
    const drv = this.drive && ctl !== this.drive.ctl && ctl.passive ? this.drive : null;
    if (drv) { const p = drv.ctl; if (Math.abs(p.y - y) < 1.5 && Math.hypot(p.x - x, p.z - z) < 7 && Math.hypot(p.x - x, p.z - z) < Math.hypot(p.x - ctl.x, p.z - ctl.z) - 1e-4 && this.mods.cars.quadsOverlap(this.mods.cars.carCorners(S.kind, x, z, yaw, 0.02), this.mods.cars.carCorners(p.S.kind, p.x, p.z, p.yaw, 0.02))) return con(drv.rec); }
    // other traffic and a lowered barrier are solid too
    if (ctl.rec && ctl.rec.collider && y > -1.2) {
      const tr = this._trafficRef(), quad = this.mods.cars.carCorners(S.kind, x, z, yaw, 0.03);
      const tc = tr && tr.hits && tr.hits(quad, cx, cz); if (tc) return con(tc === true ? 'traffic' : tc);
      if (this._barrierBlocks(quad, y)) return con('barrier');
      if (this._game && this.drive && ctl === this.drive.ctl) { const pu = this._gamePoliceHit(quad, cx, cz); if (pu) return con({ police: pu.unit || pu }); }   // V9: patrol cars are solid
      // houses of the extended city (outside the hand-built surroundings, which have their own colliders)
      const M = this._city();
      if (M && M.buildingsNear && this._cityOut(M, x, z)) { const b = this._cityHouseHit(M, quad, cx, cz, S.L / 2 + 1); if (b) return con({ building: b.id }); }
    } else if (ctl.rec && ctl.rec.collider && this._barrierBlocks(this.mods.cars.carCorners(S.kind, x, z, yaw, 0.03), y)) return con('barrier');
    if (ctl.rec && ctl.rec.collider && this._islandBlocks(x, z, yaw, S)) return con('kerb');
    const center = this._v1.set(cx, y + 0.6, cz);
    const own = ctl.rec.collider;
    const onRamp = this._rampDist(x, z) < 0.3;   // a ramp through a tower: the tower's street-level shell must not close it
    const stale = drv ? drv.rec.collider : null;
    const solids = this._near(this.solids, center, S.L / 2 + 1.2).filter(o => o !== own && o !== stale && !o.userData.floor && !o.userData.gate && !(onRamp && o.name === 'outdoor-solid') && !(ctl._wallsOnly && o.userData.carId));
    if (!solids.length) return false;
    const pts = [], fwd = ctl.v >= 0;
    for (const k of [-1, -0.5, 0, 0.5, 1]) pts.push([k * hw, fwd ? zf : zr]);
    for (const k of [0.2, 0.5, 0.8]) for (const sx of [-1, 1]) pts.push([sx * hw, fwd ? lerpN(zc, zf, k) : lerpN(zc, zr, k)]);
    for (const sx of [-1, 1]) pts.push([sx * hw, fwd ? zr + 0.3 : zf - 0.3]);   // the swinging far end while turning
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const h of [0.42, 0.95]) {
      o.set(cx, y + h, cz);
      for (const [lx, lz] of pts) {
        const [px, pz] = W(lx, lz); d.set(px - cx, 0, pz - cz); const L = d.length(); if (L < 1e-3) continue; d.divideScalar(L);
        const hit = this._cast(solids, o, d, L).find(q => !q.object.userData.floor);
        if (hit) {
          const id = hit.object.userData.carId, other = id != null && this.fleet ? this.fleet.byId(id) : null;
          let n = nrm; if (hit.face) { const fn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); if (Math.hypot(fn.x, fn.z) > 0.3) { const l = Math.hypot(fn.x, fn.z); n = [fn.x / l, fn.z / l]; } }
          ctl.contact = { point: [hit.point.x, hit.point.y, hit.point.z], normal: n, other };
          return true;
        }
      }
    }
    return false;
  },
  // does the car's footprint touch a house of the city data? (corners and edge mid-points of the car inside the outline, or a
  // vertex of the outline inside the car)
  _cityHouseHit(M, quad, cx, cz, r) {
    let list; try { list = M.buildingsNear(cx, cz, r + 2); } catch { return null; }
    if (!list || !list.length) return null;
    const inP = (P, px, pz) => { let k = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) k = !k; } return k; };
    const pts = []; for (let i = 0; i < 4; i++) { const a = quad[i], b = quad[(i + 1) % 4]; pts.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    for (const b of list) {
      if (!b || !b.poly || b.near) continue;
      if (pts.some(p => inP(b.poly, p[0], p[1])) || b.poly.some(p => inP(quad, p[0], p[1]))) return b;
    }
    return null;
  },
  _driveArea() {
    const C = this.mods.cars;
    if (this._dArea || !this.env || !this.env.group || !C || !C.createDriveArea) return this._dArea || null;
    if (!this.env.group.getObjectByName('road-strips')) return null;   // streets not built yet
    try { this._dArea = C.createDriveArea(this.env.group, { center: SITE_CENTER }); } catch (e) { console.warn('[walk] drive area', e); this._dArea = null; }
    return this._dArea;
  },
  _trafficRef() { const ctx = this.env && this.env.modules && this.env.modules.context; return (ctx && ctx.traffic) || null; },
  // tell the moving traffic what stands in its lanes: the visitor's car and the cars left on a street
  _trafficObstacles(force = false) {
    const tr = this._trafficRef(); if (!tr || !tr.setObstacles) return;
    const now = performance.now(); if (!force && now - (this._obsT || 0) < 120) return; this._obsT = now;
    const list = [];
    if (this.drive && this.drive.ctl.y > -0.6) { const c = this.drive.ctl; list.push({ x: c.x, z: c.z, kind: c.S.kind }); }
    if (this.fleet) for (const r of this.fleet.movedCars || []) if (r.y > -0.6 && (!this.drive || r !== this.drive.rec)) list.push({ x: r.x, z: r.z, kind: r.kind });
    if (this._game) { if (!this.drive && this.player.pos.y > -0.6) list.push({ x: this.player.pos.x, z: this.player.pos.z, kind: 'person' }); for (const o of this._gameRoadObstacles()) list.push(o); }   // V9: people on the road
    tr.setObstacles(list);
  },
  // is (x, z) on a carriageway? (the raster of the surroundings, or a road of the city data)
  _onRoad(x, z) {
    const A = this._driveArea(); if (A && A.test(x, z)) return true;
    const M = this._city(); if (M && M.roadAt) { try { const r = M.roadAt(x, z, 14); return !!(r && r.on); } catch { /* */ } }
    return !A;
  },
  _driveWorld() {
    if (this._dw) return this._dw;
    return (this._dw = {
      ground: (x, y, z) => this._groundAt(x, y, z),
      blocked: (ctl, x, z, yaw, y) => this._carBlocked(ctl, x, z, yaw, y),
      // the limiter of the place: car park and ramps; off the road in the open city; near the edge of the model. On a street
      // only the car's own top speed counts (the 50 on the sign is a sign).
      limit: (x, y, z) => {
        const D = this.drive; let cap = y < -0.8 ? CAR_PARK_CAP / 3.6 : this._rampDist(x, z) < 1 ? RAMP_CAP / 3.6 : 999;
        if (D && D.offRoad) cap = Math.min(cap, OFFROAD_CAP / 3.6);
        if (D && D.edge > 0) cap = Math.min(cap, lerpN(14, 3.5, D.edge));
        return cap;
      },
      // underground the car-park walls bound the car; above ground: carriageways, the plot's driveways, the ramps, the
      // forecourts (cars.js drive area) — kerbs and everything beyond them stop it. In the extended city (outside the
      // hand-built surroundings) the car may leave the road: only houses, water and the edge of the map stop it.
      // No area yet → 300 m round the yard.
      drivable: (x, z) => {
        if (this.drive && this.drive.ctl.y < -1) return true;
        const A = this._driveArea();
        if (A ? A.test(x, z) : Math.hypot(x - SITE_CENTER[0], z - SITE_CENTER[1]) < 300) return true;
        const M = this._city(); if (!M || !this._cityOut(M, x, z)) return false;
        try { if (M.insideCity && !M.insideCity(x, z)) return false; const ar = M.areaAt && M.areaAt(x, z); return !(ar && (ar.kind === 'water' || ar.kind === 'rail')); } catch { return false; }
      },
    });
  },

  // ======================= the map on the centre screen =======================
  // the streets within ≈ 350 m (data.js STREETS + the city data when it is loaded); underground: the aisles and ramps of the car park
  _mapRoads(x, y, z) {
    const under = y < -1.5, c = this._mapC, M = this._city();
    if (c && c.under === under && c.city === !!M && Math.hypot(x - c.x, z - c.z) < 70) return c;
    const roads = [], names = [], R = 380;
    if (under) {
      for (const a of PARKING.aisles || []) roads.push({ pts: a.pts, w: Math.min(3, a.width || 6) });
      for (const r of RAMPS) if (r.centerline) roads.push({ pts: r.centerline.map(p => [p[0], p[2]]), w: 3, main: true });
    } else {
      for (const st of DATA.STREETS || []) { const pts = (st.pts || []).filter(p => Math.hypot(p[0] - x, p[1] - z) < R + 150); if (pts.length > 1) { roads.push({ pts: st.pts, w: st.w || 6, main: !!st.main }); names.push(st); } }
      if (M && M.roadsNear) { try { for (const r of M.roadsNear(x, z, R)) if (r.car && !r.near) { roads.push({ pts: r.pts, w: r.w || 6, main: r.cls === 'primary' || r.cls === 'secondary' }); names.push(r); } } catch { /* optional */ } }
      for (const r of RAMPS) if (r.centerline) roads.push({ pts: r.centerline.map(p => [p[0], p[2]]), w: 4 });
    }
    const lang = this.lang || (this.opts && this.opts.lang) || 'uk';
    const name = (px, pz) => {
      if (under) return 'P −1';
      let best = null; for (const st of names) { const pts = st.pts; for (let i = 0; i + 1 < pts.length; i++) { const ax = pts[i][0], az = pts[i][1], ux = pts[i + 1][0] - ax, uz = pts[i + 1][1] - az, L2 = ux * ux + uz * uz || 1, t = clamp(((px - ax) * ux + (pz - az) * uz) / L2), d = Math.hypot(px - ax - ux * t, pz - az - uz * t); if (d < 14 && (!best || d < best.d)) best = { d, st }; } }
      const n = best && best.st.name; return n ? (typeof n === 'string' ? n : n[lang] || n.uk || n.en || '') : '';
    };
    return (this._mapC = { x, z, under, city: !!M, roads, name, marks: under ? [] : [{ x: SITE_CENTER[0], z: SITE_CENTER[1], label: 'VILNYI', r: 5 }], rev: ((c && c.rev) || 0) + 1 });
  },

  // ======================= mirrors =======================
  // One small picture of what is behind the car, drawn every few frames into a render target; the inside mirror and the two
  // door mirrors show parts of it (car-models.js createCockpit). Off (a neutral still) with ?mirrors=0 or when the target
  // cannot be made.
  _mirrorInit(D) {
    const ck = D.car.cockpit; if (!ck) return;
    try {
      if (/[?&]mirrors=0/.test(location.search) || lsGet('vrc.walk.mirrors') === 'off') return;
      const touch = !!this._isTouch, w = touch ? 256 : 384, h = touch ? 64 : 96;
      // V11: an "XR" target in RGBA8 with the screen's colour space → three.js tone-maps and sRGB-encodes into it with the SAME
      // shader programs as for the screen (a plain half-float target needed a second, linear variant of every program of the
      // scene: ≈ 150 compiles when getting into a car). The mirror quads read it back without a second tone mapping.
      const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, generateMipmaps: false });
      rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.internalFormat = 'RGBA8'; rt.isXRRenderTarget = true; rt.texture.userData.displayEncoded = true;
      const cam = new THREE.PerspectiveCamera(ck.mirrorPose.fov, ck.mirrorPose.aspect, 0.4, touch ? 140 : 240);
      D.mirror = { rt, cam, every: touch ? 6 : 3, n: 0 };
      ck.setMirrorMap(rt.texture);
    } catch (e) { console.warn('[drive] mirrors', e); D.mirror = null; }
  },
  _mirrorRender(D = this.drive, force = false, render = null) {
    const M = D && D.mirror; if (!M || !D.car.cockpit) return;
    if (!force && (D.view !== 'fp' || (M.n++ % M.every) !== 0)) return;
    const r = this.renderer, g = D.car.group, ck = D.car.cockpit;
    M.cam.position.copy(ck.mirrorPose.pos); g.localToWorld(M.cam.position);
    M.cam.rotation.set(0, D.ctl.yaw, 0, 'YXZ'); M.cam.updateMatrixWorld(true);   // a camera looks down its −z: with the car's yaw that is straight back
    const prev = r.getRenderTarget(), vis = ck.group.visible;
    ck.group.visible = false;
    try { r.setRenderTarget(M.rt); (render || r.render).call(r, this.scene, M.cam); } catch (e) { if (!this._mirErr) { this._mirErr = true; console.warn('[drive] mirror render', e); } D.mirror = null; ck.setMirrorMap(null); try { M.rt.dispose(); } catch { /* */ } }
    finally { r.setRenderTarget(prev); ck.group.visible = vis; }
  },
  _mirrorDispose(D) { if (D && D.mirror) { try { D.mirror.rt.dispose(); } catch { /* */ } D.mirror = null; } },

  // ======================= per-frame driving =======================
  _driveUpdate(dt) {
    const D = this.drive, { ctl, car, rec } = D, k = this.keys, pad = D.pad, now = performance.now();
    let gas = Math.max(k.has('KeyW') || k.has('ArrowUp') ? 1 : 0, pad.gas);
    let brake = Math.max(k.has('KeyS') || k.has('ArrowDown') ? 1 : 0, pad.brake);
    const hand = Math.max(k.has('Space') ? 1 : 0, pad.hand || 0);                // Space = handbrake (rear wheels): stops the car, and swings the tail round in a turn
    let steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
    if (D.tiltOn && Math.abs(D.tilt) > Math.abs(steer)) steer = D.tilt;
    // R held: reset
    if (D.rHold && now - D.rHold > 1100) { D.rHold = null; this._resetCar(); return; }
    // the edge of the model: slow down in time (the faster, the earlier), then the car is turned round on the spot
    const A = this._driveArea(), fx0 = Math.sin(ctl.yaw), fz0 = Math.cos(ctl.yaw), M = this._city();
    D.edge = 0;
    if (ctl.y > -1 && (A || M)) {
      const sgn = Math.sign(ctl.v || 1), stop = ctl.v * ctl.v / (2 * 7) * sgn, px = ctl.x + fx0 * stop, pz = ctl.z + fz0 * stop;   // where the car could come to rest
      let e = 0;
      if (M && M.insideCity) { try { e = M.insideCity(px, pz) ? (M.insideCity(px + fx0 * 30 * sgn, pz + fz0 * 30 * sgn) ? 0 : 0.5) : 1; } catch { e = 0; } }
      else if (A && A.edge) { const rx = ctl.x - SITE_CENTER[0], rz = ctl.z - SITE_CENTER[1], rl = Math.hypot(rx, rz) || 1, out = (fx0 * rx + fz0 * rz) / rl * sgn; e = out > 0.2 ? Math.max(A.edge(ctl.x, ctl.z), A.edge(px, pz)) : 0; }
      if (e > 0) {
        D.edge = e;
        if (now - (this._edgeT || 0) > 6000) { this._edgeT = now; this._toast(this.t('walk.car.edge'), 3200); }
        const rx = ctl.x - SITE_CENTER[0], rz = ctl.z - SITE_CENTER[1];
        if (e > 0.82 && !D.turn) D.turn = { t: 0, yaw0: ctl.yaw, dir: (fx0 * rz - fz0 * rx) > 0 ? -1 : 1 };
      }
    }
    D.offRoad = ctl.y > -0.6 && !!M && this._cityOut(M, ctl.x, ctl.z) && !this._onRoad(ctl.x, ctl.z);
    const world = this._driveWorld();
    ctl.impact = null;
    if (D.turn) {
      // gentle turn-back: brake to a stop, swing the car round half a turn, hand the wheel back
      const T = D.turn;
      if (Math.abs(ctl.v) > 0.3) { const n = Math.max(1, Math.ceil(dt * 60)); for (let i = 0; i < n; i++) ctl.step(dt / n, { brake: 1, gear: ctl.gear }, world); }
      else { ctl.v = 0; T.t += dt / 2.2; ctl.yaw = T.yaw0 + T.dir * Math.PI * sstep(T.t); ctl.steer = T.dir * 0.4 * Math.sin(Math.PI * clamp(T.t)); if (T.t >= 1) { D.turn = null; ctl.steer = 0; D.gear = 'D'; D.manual = false; ctl.gear = 'D'; ctl._autoR = false; } }
    } else {
      // V19: two pedals only — right = gas (forward), left = brake; holding the brake at a standstill drives backwards
      // (keys: ↑ / W gas, ↓ / S brake-reverse). D.manual / D.gear remain only as a test hook.
      const inp = { gas, brake, steer, hand, gear: D.manual ? D.gear : 'D', auto: !D.manual };
      const n = Math.min(6, Math.max(1, Math.ceil(dt / (1 / 60))));   // ≥ 60 Hz dynamics; the controller cuts each step into moves of ≤ 0.3 m
      const hit0 = ctl.hit; ctl.hit = 0;
      for (let i = 0; i < n; i++) ctl.step(dt / n, inp, world);
      void hit0;
      // a trail of free-running poses for the reset
      if (!ctl.hit && Math.abs(ctl.v) > 1.5 && now - D.trailT > 700) { D.trailT = now; D.trail.push({ t: now, x: ctl.x, y: ctl.y, z: ctl.z, yaw: ctl.yaw, pitch: ctl.pitch }); if (D.trail.length > 40) D.trail.shift(); }
    }
    // a contact → damage, sound, pushed cars, events (the hardest one of this frame)
    if (ctl.impact && ctl.impact.speed > 0.7 && now - (D.colT || 0) > 60) { D.colT = now; try { this._carImpact(D, ctl.impact, now); } catch (e) { console.warn('[drive] impact', e); } }
    D.scrape = Math.max(0, (D.scrape || 0) - dt * 4);
    // a wrecked car: the starter turns, nothing else
    if (ctl.disabled && gas > 0.5 && now - (D.failT || 0) > 2600) { D.failT = now; const A = this._carAudio(); if (A) A.startFail(); if (rec.dmg && rec.dmg.dead && now - (D.failToast || 0) > 9000) { D.failToast = now; this._toast(this.t('walk.car.wrecked'), 5000); } }
    if (rec.dmg && rec.dmg.dead && D.ind !== 2) { D.ind = 2; D.indT = now; }
    // car pose
    Object.assign(rec, { x: ctl.x, y: ctl.y, z: ctl.z, yaw: ctl.yaw, pitch: ctl.pitch, roll: ctl.roll });
    const g = car.group;
    g.position.set(ctl.x, ctl.y + ctl.bump * Math.sin(now / 30), ctl.z);
    g.rotation.set(-(ctl.pitch + (ctl.dive || 0)), ctl.yaw, ctl.roll, 'YXZ');
    g.updateMatrixWorld(true);
    car.setWheels(ctl.spin, ctl.steer);
    this.player.pos.set(ctl.x, ctl.y, ctl.z);
    // indicators cancel themselves once the wheel comes back from a real turn
    if (D.ind === 1 || D.ind === -1) { const sN = ctl.steer / (ctl.perf.lock || 0.6) * D.ind; D.indSteer = Math.max(D.indSteer, Math.abs(ctl.v) > 1 ? sN : 0); if (D.indSteer > 0.3 && sN < 0.06) D.ind = 0; else if (now - D.indT > 30000) D.ind = 0; }
    const blink = Math.floor((now - D.indT) / 380) % 2 === 0, haz = !!D.turn || D.ind === 2;
    const left = (haz || D.ind === 1) && blink, right = (haz || D.ind === -1) && blink;
    if ((D.ind || haz) && blink !== D.blinkWas) { const A = this._carA; if (A && dt) A.tick(blink); } D.blinkWas = blink;
    // lights: on at dusk / night and underground; brake lights while braking or held on the brake; reversing lamps
    const under = ctl.y < -0.8, on = this._lightsOn(D);
    const stopHeld = (ctl.reversing ? gas : brake) > 0 && Math.abs(ctl.v) < 0.3;
    car.setLights(on, (ctl.braking && Math.abs(ctl.v) > 0.2) || stopHeld || !!D.turn, ctl.reversing && !D.turn, left, right);
    const fx = Math.sin(ctl.yaw), fz = Math.cos(ctl.yaw), S = ctl.S;
    if (this.headSpot) {
      this.headSpot.intensity = on ? (under ? 60 : this.envMode === 'day' ? 30 : 110) : 0;
      this.headSpot.distance = under ? 42 : 70;
      this.headSpot.position.set(ctl.x + fx * (S.zF - 0.3), ctl.y + 0.72, ctl.z + fz * (S.zF - 0.3));
      this.headSpot.target.position.set(ctl.x + fx * (S.zF + 14), ctl.y - 0.6 + Math.sin(ctl.pitch) * 14, ctl.z + fz * (S.zF + 14));
      this.headSpot.target.updateMatrixWorld(true);
    }
    this._barrierUpdate(dt || 0.016, ctl);
    this._trafficObstacles();
    // V19: a stolen patrol car — its beacon flashes while the visitor drives it
    if (car.livery) { try { car.livery.setLights(D.beacon !== false, now / 1000, this.envMode === 'night'); } catch { /* look only */ } }
    // wipers
    const ck = car.cockpit;
    if (ck) { if (D.wipers || D.wipT % 1 > 0.001) { D.wipT += (dt || 0) / 1.3; if (!D.wipers && D.wipT % 1 < 0.03) D.wipT = Math.round(D.wipT); } ck.setWipers(0.5 - 0.5 * Math.cos(D.wipT * Math.PI * 2)); }
    // camera
    const cam = this.camera, L = D.look, kmhAbs = Math.abs(ctl.v) * 3.6;
    if (!this._dragging) { L.yaw *= 1 - damp(2.2, dt); L.pitch *= 1 - damp(2.2, dt); }
    const rush = Math.min(13, Math.max(0, kmhAbs - 70) * 0.062);              // the view widens a little at speed
    const fr = D.view === 'fp' ? this._fpFrame(D, this.container.clientWidth || window.innerWidth, this.container.clientHeight || window.innerHeight) : null;
    this._driveViewport(fr ? fr.deck : 0);
    this._paniniSet(fr);
    if (fr) {
      // V10: the driver's real head point (car-models.js `head`), the view framed on the glass (_fpFrame): the camera renders the
      // source rectangle (off-centre lens); with the Panini pass on, _paniniSet maps it onto the screen
      if (cam.aspect !== fr.src.aspect || cam.fov !== fr.src.fov) { cam.aspect = fr.src.aspect; cam.fov = fr.src.fov; }
      cam.updateProjectionMatrix(); const P = cam.projectionMatrix.elements; P[8] = fr.src.sx; P[9] = fr.src.sy; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      const e = fr.eye.clone();
      car.group.localToWorld(e);
      cam.position.copy(e);
      // look a little into the corner, like a driver does; reversing with the view turned far round = looking over the shoulder
      cam.rotation.set(ctl.pitch * 0.9 + FP_PITCH + L.pitch, ctl.yaw + Math.PI + FP_YAW + L.yaw + ctl.steer * 0.14, -ctl.roll * 0.6, 'YXZ');
    } else {
      const vf = Math.min(this._fovWalk || cam.fov, cam.aspect < 1 ? 100 : 72) + rush;
      if (Math.abs(cam.fov - vf) > 0.05) { cam.fov += (vf - cam.fov) * (dt ? damp(4, dt) : 1); cam.updateProjectionMatrix(); }
      { const P = cam.projectionMatrix.elements; if (P[8] || P[9]) cam.updateProjectionMatrix(); }
      const dist = (under ? 5.2 : 6.4) + Math.min(3.2, Math.abs(ctl.v) * 0.045), h = under ? 1.7 : 2.4;
      const a = ctl.yaw + L.yaw;
      const want = new THREE.Vector3(ctl.x - Math.sin(a) * dist, ctl.y + h, ctl.z - Math.cos(a) * dist);
      // keep the camera on our side of walls / columns and under the car-park ceiling
      const from = new THREE.Vector3(ctl.x, ctl.y + 1.3, ctl.z), dir = want.clone().sub(from), len = dir.length(); dir.divideScalar(len);
      const sol = this._near(this.solids, from, len + 1).filter(o => o !== rec.collider && !o.userData.carId);
      const hit = this._cast(sol, from, dir, len).find(q => !q.object.userData.floor);
      if (hit) want.copy(from).addScaledVector(dir, Math.max(0.6, hit.distance - 0.35));
      if (under) { const up = this._cast(this._near(this.solids, want, 3), new THREE.Vector3(want.x, ctl.y + 1.0, want.z), new THREE.Vector3(0, 1, 0), 2.2).find(q => !q.object.userData.carId); if (up) want.y = Math.min(want.y, up.point.y - 0.25); }
      if (!D.cam) D.cam = want.clone(); else D.cam.lerp(want, damp(dt ? 7 + Math.abs(ctl.v) * 0.12 : 1000, dt || 1));
      cam.position.copy(D.cam);
      cam.lookAt(ctl.x + fx * 1.6, ctl.y + 1.0 + L.pitch * 3, ctl.z + fz * 1.6);
    }
    this._syncEnvMap();
    // the instruments and the centre screen (≈ 12 × per second), the mirrors (every few frames)
    if (ck && now - D.hudT > 80) {
      D.hudT = now; const R = this._radio, rs = R ? R.state : null, dn = new Date();
      const lim = under || this._rampDist(ctl.x, ctl.z) < 1 ? CAR_PARK_LIMIT : STREET_LIMIT;
      const dm = rec.dmg, eng = dm ? dm.engine : 0, night = this.envMode === 'night' || (under && this.envMode !== 'day');
      if (rec.fuel == null) { let h = 0; for (let i = 0; i < rec.id.length; i++) h = (h * 31 + rec.id.charCodeAt(i)) >>> 0; rec.fuel = 0.42 + (h % 53) / 100; }
      const mapR = this._mapRoads(ctl.x, ctl.y, ctl.z);
      ck.draw({ kmh: kmhAbs, rpm: ctl.perf.eng === 'ev' ? Math.abs(ctl.aLong) / (ctl.perf.acc || 8) * ctl.redline * (gas > 0 ? 1 : 0.25) : ctl.disabled ? 0 : ctl.rpm, redline: ctl.redline, gear: D.turn ? 'P' : ctl.gearShown, gearNo: ctl.gearNo, lights: on, left, right, limit: lim, disabled: ctl.disabled,
        fuel: rec.fuel, temp: clamp(0.5 + eng * 0.46), odo: (D.odo || 0) / 1000, night,
        warn: { engine: eng > 0.3 || ctl.disabled, abs: ctl.abs && blink, hand: ctl.hand, hazard: haz && blink, fuel: rec.fuel < 0.12, door: car.doorOpen > 0.05, temp: eng > 0.75 },
        map: { x: ctl.x, z: ctl.z, yaw: ctl.yaw, roads: mapR.roads, marks: mapR.marks, rev: mapR.rev, scale: under ? 2.2 : kmhAbs > 120 ? 0.55 : 0.95, street: mapR.name(ctl.x, ctl.z) },
        msg: rs && rs.on && rs.status === 'error' ? this.t('walk.radio.none') : '',
        radio: rs ? { on: rs.on, name: rs.station ? rs.station.name : '', freq: rs.station ? rs.station.freq : '', status: rs.status, volume: rs.volume, muted: rs.muted } : { on: false },
        clock: String(dn.getHours()).padStart(2, '0') + ':' + String(dn.getMinutes()).padStart(2, '0'),
        labels: this._ckLabels || (this._ckLabels = { radio: this.t('walk.radio.title'), off: this.t('walk.radio.off'), connecting: this.t('walk.radio.connecting'), noSignal: this.t('walk.radio.noSignal'), live: this.t('walk.radio.live'), kmh: this.t('walk.car.kmh') }) });
    }
    { const dist = Math.abs(ctl.v) * (dt || 0); D.odo = (D.odo || 0) + dist; if (rec.fuel != null && ctl.perf.eng) rec.fuel = Math.max(0.05, rec.fuel - dist * (0.000004 + gas * 0.000006)); }
    this._mirrorRender(D);
    this._carSoundUpdate(ctl, ctl.reversing ? brake : gas, dt);
    if (this.fleet) this.fleet.update(cam);
    this._carsTick(dt);
    this._renderDriveHud(false);
    if (now - D.tickT >= TICK_MS) {
      D.tickT = now;
      this._emitDrive('drive:tick', { car: rec, pos: { x: ctl.x, y: ctl.y, z: ctl.z }, vel: { x: fx * ctl.v, z: fz * ctl.v }, speedKmh: ctl.v * 3.6, heading: ctl.yaw, steer: ctl.steer, braking: ctl.braking, onRoad: !D.offRoad });
    }
  },

  // ======================= HUD =======================
  // extra controls for driving (gear D / R, horn, radio, tilt steering, reset) — added to walk.js' drive panel once
  _driveHudInit() {
    const e = this.el; if (!e || e.dxInit || !e.drive) return;
    e.dxInit = true;                                                    // (V19: e.dgear is gone — the controls are built once)
    const st = document.createElement('style'); st.textContent = CSS; e.drive.appendChild(st);
    { const dk = document.createElement('div'); dk.className = 'vw-ddeck'; dk.setAttribute('aria-hidden', 'true'); e.drive.insertBefore(dk, e.drive.firstChild); }   // V10: portrait control deck (below the 3D band)
    const x = document.createElement('div'); x.className = 'vw-dx vw-dxr';
    x.innerHTML = `<button class="vw-dround vw-dhand" data-kd="hand">${ICON.hand}</button><button class="vw-dround" data-kd="horn">${ICON.horn}</button><button class="vw-dround vw-dind" data-kd="indL">${ICON.indL}</button><button class="vw-dround vw-dind" data-kd="indR">${ICON.indR}</button>`;   // V19: no gear selector (two pedals)
    e.drive.appendChild(x);
    const name = document.createElement('div'); name.className = 'vw-dname'; e.drive.appendChild(name);
    // the radio: previous · station · next · quieter · louder · on / off
    const rd = document.createElement('div'); rd.className = 'vw-dradio off'; rd.setAttribute('role', 'group');
    rd.innerHTML = `<button data-kr="prev">${ICON.prev}</button><span class="st"><b></b><i></i></span><button data-kr="next">${ICON.next}</button><button data-kr="down">${ICON.volDn}</button><button data-kr="up">${ICON.volUp}</button><button data-kr="power">${ICON.power}</button>`;
    e.drive.appendChild(rd);
    rd.addEventListener('click', ev => { const b = ev.target.closest('[data-kr]'); if (!b) return; ev.stopPropagation(); this._radioCmd(b.dataset.kr); });
    rd.addEventListener('pointerdown', ev => ev.stopPropagation());
    e.dradio = rd; e.dradioName = rd.querySelector('.st b'); e.dradioSub = rd.querySelector('.st i');
    // V10: the radio folds into a small button (phones: folded by default, the windscreen stays free); the choice is remembered
    const rbtn = document.createElement('button'); rbtn.className = 'vw-dround vw-dradiobtn'; rbtn.innerHTML = ICON.radio + '<i class="dot" aria-hidden="true"></i>';
    rbtn.addEventListener('click', ev => { ev.stopPropagation(); this._radioBar(!this.root.classList.contains('radio-open')); });
    rbtn.addEventListener('pointerdown', ev => ev.stopPropagation());
    e.drive.appendChild(rbtn); e.dradioBtn = rbtn;
    const top = e.drive.querySelector('.vw-dtop');
    // V21: the less-used buttons (reset, wipers, hazard, tilt) sit in .vw-dmenu: on a desktop it is display:contents (the row as
    // before); on a phone it folds behind a «⋯» button and opens as a small panel, so the top row fits one line on any phone
    const menu = document.createElement('div'); menu.className = 'vw-dmenu'; menu.setAttribute('role', 'group'); top.insertBefore(menu, top.firstChild);
    const more = document.createElement('button'); more.className = 'vw-btn vw-ghost vw-ico vw-dmorebtn'; more.dataset.kd = 'more'; more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false'); more.innerHTML = ICON.more; top.insertBefore(more, top.firstChild);
    e.dmenu = menu; e.dmore = more;
    more.addEventListener('click', ev => { ev.stopPropagation(); this._driveMenu(!this.root.classList.contains('dmenu-open')); });
    more.addEventListener('pointerdown', ev => ev.stopPropagation());
    menu.addEventListener('click', ev => { if (ev.target.closest('button')) setTimeout(() => this._driveMenu(false), 160); });
    this.root.addEventListener('pointerdown', ev => { if (this.root.classList.contains('dmenu-open') && !ev.target.closest('.vw-dmenu,.vw-dmorebtn')) this._driveMenu(false); }, true);
    const mk = (kd, html) => { const b = document.createElement('button'); b.className = 'vw-btn vw-ghost vw-ico'; b.dataset.kd = kd; b.innerHTML = html; menu.insertBefore(b, menu.firstChild); return b; };
    e.dreset = mk('reset', ICON.reset);
    e.dwipers = mk('wipers', ICON.wipers); e.dhazard = mk('hazard', ICON.hazard);                       // V19: wipers, hazard lights
    if (this._isTouch && typeof window.DeviceOrientationEvent !== 'undefined') e.dtilt = mk('tilt', ICON.tilt);
    e.dgear = null; e.dindL = x.querySelector('[data-kd=indL]'); e.dindR = x.querySelector('[data-kd=indR]'); e.dhorn = x.querySelector('[data-kd=horn]'); e.dname = name; e.dhand = x.querySelector('[data-kd=hand]');
    { const b = e.dhand, on = ev => { ev.preventDefault(); ev.stopPropagation(); try { b.setPointerCapture(ev.pointerId); } catch { /* */ } b.classList.add('on'); if (this.drive) this.drive.pad.hand = 1; }, off = () => { b.classList.remove('on'); if (this.drive) this.drive.pad.hand = 0; };
      b.addEventListener('pointerdown', on); for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(n, off); b.addEventListener('contextmenu', ev => ev.preventDefault()); }
    for (const [b, f] of [[e.dindL, () => this._setIndicator(1)], [e.dindR, () => this._setIndicator(-1)], [e.dhazard, () => this._setIndicator(2)], [e.dwipers, () => this._toggleWipers()]]) {
      b.addEventListener('click', ev => { ev.stopPropagation(); f(); this._renderDriveHud(true); }); b.addEventListener('pointerdown', ev => ev.stopPropagation()); }
    e.dreset.addEventListener('click', ev => { ev.stopPropagation(); this._resetCar(); });
    if (e.dtilt) e.dtilt.addEventListener('click', ev => { ev.stopPropagation(); this._toggleTilt(); });
    const hOn = ev => { ev.preventDefault(); ev.stopPropagation(); try { e.dhorn.setPointerCapture(ev.pointerId); } catch { /* */ } e.dhorn.classList.add('on'); this._hornStart(); };
    const hOff = () => { e.dhorn.classList.remove('on'); this._hornStop(); };
    e.dhorn.addEventListener('pointerdown', hOn); for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) e.dhorn.addEventListener(n, hOff);
    e.dhorn.addEventListener('contextmenu', ev => ev.preventDefault());
  },
  _driveMenu(open) {
    const e = this.el; if (!e || !e.dmore) return;
    this.root.classList.toggle('dmenu-open', !!open); e.dmore.setAttribute('aria-expanded', open ? 'true' : 'false'); e.dmore.classList.toggle('on', !!open);
  },
  _renderDriveHud(force) {
    const D = this.drive, e = this.el; if (!D || !e) return;
    const ctl = D.ctl, kmh = Math.round(Math.abs(ctl.v) * 3.6), lim = ctl.y < -0.8 || this._rampDist(ctl.x, ctl.z) < 1 ? CAR_PARK_LIMIT : STREET_LIMIT;
    const gear = D.turn ? 'P' : ctl.gearShown;
    if (force || kmh !== this._lastKmh || gear !== this._lastGear) {
      this._lastKmh = kmh; this._lastGear = gear; e.spd.textContent = String(kmh); e.gear.textContent = gear;
      const f = Math.min(1, kmh / (lim === CAR_PARK_LIMIT ? 40 : Math.max(120, ctl.perf.vmax))); e.arc.style.strokeDasharray = `${(141.4 * f).toFixed(1)} 200`;
      if (e.dgear) for (const i of e.dgear.querySelectorAll('i')) i.classList.toggle('on', i.dataset.g === (ctl.reversing ? 'R' : 'D'));
      if (e.dindL) { e.dindL.classList.toggle('on', D.ind === 1); e.dindR.classList.toggle('on', D.ind === -1); e.dhazard.classList.toggle('on', D.ind === 2); e.dwipers.classList.toggle('on', !!D.wipers); }
      if (e.dmore) e.dmore.classList.toggle('lit', D.ind === 2 || !!D.wipers || !!D.tiltOn);
    }
    if (force || lim !== this._lastLim) { this._lastLim = lim; e.lim.textContent = String(lim); if (!force && lim === CAR_PARK_LIMIT && this.el) this._toast(this.t('walk.car.parkLimit').replace('{n}', CAR_PARK_LIMIT), 2600); }
    e.spdo.classList.toggle('over', kmh > lim + 2);
    if (force) {
      e.carLights.classList.toggle('on', this._lightsOn(D)); e.carSound.classList.toggle('on', !this._carMuted());
      e.carView.querySelector('.lbl').textContent = this.t(D.view === 'fp' ? 'walk.car.chase' : 'walk.car.cockpit');
      e.carExit.querySelector('.lbl').textContent = this.t('walk.car.exit');
      e.dhint.textContent = this.t('walk.car.hint');
      if (e.dname) e.dname.innerHTML = `<b>${ctl.S.name}</b>${D.car.plate ? ' · ' + D.car.plate : ''}`;
      const lab = (b, k) => { if (b) { b.setAttribute('aria-label', this.t(k)); b.title = this.t(k); } };
      lab(e.dindL, 'walk.car.indL'); lab(e.dindR, 'walk.car.indR'); lab(e.dhazard, 'walk.car.hazard'); lab(e.dwipers, 'walk.car.wipers'); lab(e.dhorn, 'walk.car.horn'); lab(e.dhand, 'walk.car.handbrake'); lab(e.dreset, 'walk.car.resetBtn'); lab(e.dmore, 'walk.car.more'); lab(e.carView, D.view === 'fp' ? 'walk.car.chase' : 'walk.car.cockpit'); lab(e.dtilt, 'walk.car.tilt'); lab(e.carSound, 'walk.car.sound');
      this._radioBar(null);
      if (e.dradio) { e.dradio.setAttribute('aria-label', this.t('walk.radio.title')); for (const [kr, key] of [['prev', 'walk.radio.prev'], ['next', 'walk.radio.next'], ['down', 'walk.radio.volDown'], ['up', 'walk.radio.volUp'], ['power', 'walk.radio.power']]) lab(e.dradio.querySelector(`[data-kr=${kr}]`), key); this._radioHud(); }
      if (e.dtilt) e.dtilt.classList.toggle('on', !!D.tiltOn);
      const sp = e.brake && e.brake.querySelector('span'); if (sp) sp.textContent = this.t('walk.car.brakeShort');
      const sg = e.gas && e.gas.querySelector('span'); if (sg) sg.textContent = this.t('walk.car.gasShort');
      this._ckLabels = null;
    }
  },

  // ---- tilt steering (phones / tablets, optional): roll the device like a wheel
  async _toggleTilt() {
    const D = this.drive; if (!D) return;
    if (D.tiltOn) { D.tiltOn = false; this._tiltStop(); this.root.classList.remove('tilt'); return this._renderDriveHud(true); }
    try { const DO = window.DeviceOrientationEvent; if (DO && typeof DO.requestPermission === 'function') { const r = await DO.requestPermission(); if (r !== 'granted') { this._toast(this.t('walk.car.tiltDenied'), 2400); return; } } } catch { this._toast(this.t('walk.car.tiltDenied'), 2400); return; }
    this._tiltFn = ev => {
      const Dd = this.drive; if (!Dd || !Dd.tiltOn || ev.gamma == null) return;
      const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      // roll about the axis that points into the screen: gamma in portrait, ±beta in landscape
      const roll = ang === 90 ? ev.beta : ang === 270 || ang === -90 ? -ev.beta : ev.gamma;
      const k = clamp(roll / 28, -1, 1); Dd.tilt = -(Math.abs(k) < 0.08 ? 0 : k);
    };
    window.addEventListener('deviceorientation', this._tiltFn);
    D.tiltOn = true; D.tilt = 0; this.root.classList.add('tilt'); this._renderDriveHud(true);
    this._toast(this.t('walk.car.tiltOn'), 2400);
  },
  _tiltStop() { if (this._tiltFn) { window.removeEventListener('deviceorientation', this._tiltFn); this._tiltFn = null; } },

  // ======================= sound (car-audio.js: all generated, WebAudio) =======================
  // One master gain for the car (the HUD's sound button / M mutes it together with the radio). Engine per car type, tyres,
  // wind, gear shifts, horn per class, indicator relay, impacts, the alarm of a parked car. The radio is lowered under the horn.
  _carAudio() {
    const ac = this._audio(); if (!ac) return null;
    if (this._carA && this._carA.ac === ac) return this._carA;
    try { this._carA = createCarAudio(ac, { muted: this._carMuted() }); } catch (e) { console.warn('[drive] audio', e); this._carA = null; }
    return this._carA;
  },
  _engineStart(kind) { const A = this._carAudio(); if (!A || A.state.engine) return; A.engineStart(this.mods.cars.carSpec(kind)); this._eng = A; },
  _carSoundUpdate(ctl, gas, dt) {
    const A = this._eng; if (!A) return; void dt; const D = this.drive, dm = D && D.dmg;
    A.update({ rpm: ctl.rpm, redline: ctl.redline, throttle: gas, v: ctl.v, gearNo: ctl.reversing ? 0 : ctl.gearNo, squeal: ctl.squeal, slip: Math.abs(ctl.beta || 0) * 2, under: ctl.y < -0.8, disabled: ctl.disabled, damage: dm ? dm.engine : 0, scrape: D ? D.scrape || 0 : 0 });
  },
  _engineUpdate(ctl, gas, dt) { this._carSoundUpdate(ctl, gas, dt); },   // older name
  _engineStop() { const A = this._eng; this._eng = null; if (A) A.engineStop(); },
  _carSoundsStop() { this._engineStop(); this._hornStop(); },
  _hornStart() {
    if (this._hornOn || !this.drive) return;
    this._hornOn = true; this._emitDrive('drive:horn', { car: this.drive.rec, on: true });
    if (this._radio && this._radio.setDuck) this._radio.setDuck(0.25);
    const A = this._carAudio(); if (A) A.horn(true, this.drive.ctl.S);
  },
  _hornStop() {
    if (this._hornOn) { this._hornOn = false; if (this.drive) this._emitDrive('drive:horn', { car: this.drive.rec, on: false }); }
    if (this._radio && this._radio.setDuck) this._radio.setDuck(1);
    const A = this._carA; if (A) A.horn(false);
  },
  // the thud of a contact; a hard one (speed m/s) adds the crunch of metal, and glass when something broke
  _thud(k = 1, speed = 0, opts = {}) {
    const A = this._carAudio(); if (A) A.impact(Math.max(speed, k * 2.5), opts);
    if (navigator.vibrate) try { navigator.vibrate(speed > 5 ? 80 : 30); } catch { /* optional */ }
  },
};
