// ЖК VILNYI (Uzhhorod) — the snooker table of the big top-floor duplexes: model, 2D ball physics and the play mode.
//   buildSnookerTable(m, {size, ceiling}) → THREE.Group (origin at floor centre, long axis = x). Static parts are baked by
//     apartment.js; the balls (one InstancedMesh), the cue, the chalk and two invisible tap proxies stay live in one
//     unbaked group. userData.game is the controller: frame(walker, dt) is called once per frame by walk.js (after its
//     own update, before render) — it shows the "Play" prompt near the table and, in play mode, runs the physics and
//     owns the camera. Tapping the table / the chalk goes through the walkthrough's normal tap contract
//     (userData.playPart → action {type:'aptDoor', part:'snooker'|'chalk'} + userData.toggle, wired by apartment.js).
//   buildCueRack(m) → floor stand with cues, the triangle and spare chalk (static).
//   createGame / rack / step / shoot / settle / aimTrace: the pure 2D game (no three.js state) — also used by the tests.
// Compact tables only (a 12 ft table needs a 6.3 × 4.5 m clear zone): 8 ft or 7 ft bed with a 10-red snooker set.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FX } from './furniture.js';

export const TABLES = { 8: { ft: 8, PL: 2.24, PW: 1.12 }, 7: { ft: 7, PL: 1.98, PW: 0.99 } };
const R = 0.026, CUSH = 0.05, RAIL = 0.105, BED = 0.8, RAILH = 0.038;
const HALF = Math.PI / 2;
export const tableOuter = (size) => ({ len: TABLES[size].PL + 2 * (CUSH + RAIL), wid: TABLES[size].PW + 2 * (CUSH + RAIL) });

// ================================================================== game (2D, table frame: x along the bed, z across)
const FA = 0.16, FK = 0.33, E_BALL = 0.95, E_CUSH = 0.78, VMAX = 4.3, SUB = 1 / 300;
const CAP = { c: 0.052, m: 0.054 }, MOUTH = { c: 0.082, m: 0.074 };

export function createGame(size = 8) {
  const { PL, PW } = TABLES[size], X = PL / 2, Z = PW / 2;
  const G = { size, PL, PW, r: R, balls: [], score: 0, potted: 0, shots: 0, moving: false, events: [], fresh: [], done: false,
    pockets: [[-X - 0.004, -Z - 0.004, 'c'], [X + 0.004, -Z - 0.004, 'c'], [-X - 0.004, Z + 0.004, 'c'], [X + 0.004, Z + 0.004, 'c'], [0, -Z - 0.03, 'm'], [0, Z + 0.03, 'm']] };
  rack(G);
  return G;
}
// Snooker spots scaled to the bed: baulk line + D, blue on the centre spot, pink, black; 10 reds behind the pink.
export function rack(G) {
  const { PL, PW, r } = G, bx = -PL / 2 + PL * 0.2064, dr = PW * 0.164, px = PL / 4, d = 2 * r + 0.0008;
  const B = (kind, color, value, x, z) => ({ kind, color, value, x, z, vx: 0, vz: 0, on: true, sx: x, sz: z, drop: 0 });
  const b = [B('cue', '#f3efe2', 0, bx - dr * 0.5, -dr * 0.5)];
  for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) b.push(B('red', '#b3141c', 1, px + d + 0.003 + row * d * 0.8660254, (i - row / 2) * d));
  b.push(B('yellow', '#e6c21a', 2, bx, dr), B('green', '#0e7a3d', 3, bx, -dr), B('brown', '#6a3a1f', 4, bx, 0), B('blue', '#1e56c8', 5, 0, 0),
    B('pink', '#ee8fae', 6, px, 0), B('black', '#151515', 7, PL / 2 - PL * 0.0907, 0));
  G.balls = b; G.D = { x: bx, r: dr };
  G.score = 0; G.potted = 0; G.shots = 0; G.moving = false; G.done = false; G.events.length = 0; G.fresh.length = 0;
  return G;
}
function pot(G, b, pi) {
  b.on = false; b.vx = b.vz = 0; b.drop = 1; b.pocket = pi; b.x = G.pockets[pi][0]; b.z = G.pockets[pi][1];
  G.fresh.push(b); G.events.push({ t: 'pot', kind: b.kind, pocket: pi });
}
// Advance the balls by dt (fixed sub-steps): rolling friction, elastic ball–ball impacts, cushions, pockets.
export function step(G, dt) {
  const { PL, PW, r, balls, pockets, events } = G, X = PL / 2 - r, Z = PW / 2 - r, n = Math.max(1, Math.ceil(dt / SUB)), h = dt / n, D2 = 4 * r * r;
  let moving = false;
  for (let s = 0; s < n; s++) {
    for (const b of balls) {
      if (!b.on) continue;
      const sp = Math.hypot(b.vx, b.vz); if (sp === 0) continue;
      const ns = sp - (FA + FK * sp) * h;
      if (ns < 0.006) { b.vx = b.vz = 0; continue; }
      const k = ns / sp; b.vx *= k; b.vz *= k; b.x += b.vx * h; b.z += b.vz * h;
    }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]; if (!a.on) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]; if (!b.on) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        if (d2 >= D2) continue;
        const d = Math.sqrt(d2) || 1e-6, nx = d2 ? dx / d : 1, nz = d2 ? dz / d : 0, ov = (2 * r - d) / 2;
        a.x -= nx * ov; a.z -= nz * ov; b.x += nx * ov; b.z += nz * ov;
        const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vn > 0) {
          const jn = vn * (1 + E_BALL) / 2;
          a.vx -= jn * nx; a.vz -= jn * nz; b.vx += jn * nx; b.vz += jn * nz;
          if (vn > 0.05) events.push({ t: 'hit', v: vn });
        }
      }
    }
    for (const b of balls) {
      if (!b.on) continue;
      let best = -1, bd = 1e9;
      for (let p = 0; p < pockets.length; p++) { const d = Math.hypot(b.x - pockets[p][0], b.z - pockets[p][1]); if (d < bd) { bd = d; best = p; } }
      const kind = pockets[best][2];
      if (bd < CAP[kind]) { pot(G, b, best); continue; }
      if (bd < MOUTH[kind]) {                       // in the jaws: no cushion here — in, or on towards the drop
        if (Math.abs(b.x) > PL / 2 + 0.012 || Math.abs(b.z) > PW / 2 + 0.012) pot(G, b, best);
        continue;
      }
      if (b.x > X) { b.x = 2 * X - b.x; if (b.vx > 0) { if (b.vx > 0.15) events.push({ t: 'cushion', v: b.vx }); b.vx = -b.vx * E_CUSH; b.vz *= 0.97; } }
      else if (b.x < -X) { b.x = -2 * X - b.x; if (b.vx < 0) { if (b.vx < -0.15) events.push({ t: 'cushion', v: -b.vx }); b.vx = -b.vx * E_CUSH; b.vz *= 0.97; } }
      if (b.z > Z) { b.z = 2 * Z - b.z; if (b.vz > 0) { if (b.vz > 0.15) events.push({ t: 'cushion', v: b.vz }); b.vz = -b.vz * E_CUSH; b.vx *= 0.97; } }
      else if (b.z < -Z) { b.z = -2 * Z - b.z; if (b.vz < 0) { if (b.vz < -0.15) events.push({ t: 'cushion', v: -b.vz }); b.vz = -b.vz * E_CUSH; b.vx *= 0.97; } }
    }
  }
  for (const b of balls) if (b.on && (b.vx || b.vz)) { moving = true; break; }
  G.moving = moving;
  return moving;
}
const isFree = (G, x, z, self) => G.balls.every(o => o === self || !o.on || Math.hypot(o.x - x, o.z - z) > 2 * G.r + 0.002);
function respot(G, b) {
  let x = b.sx, z = b.sz;
  for (let i = 0; i < 60 && !isFree(G, x, z, b); i++) x = Math.min(G.PL / 2 - G.r - 0.01, x + G.r * 0.6);   // as near its spot as possible, towards the top cushion
  if (!isFree(G, x, z, b)) for (let i = 0; i < 80 && !isFree(G, x, z, b); i++) x -= G.r * 0.6;
  Object.assign(b, { x, z, vx: 0, vz: 0, on: true, drop: 0 });
}
function respawnCue(G, b) {
  const D = G.D;
  for (let k = 0; k < 40; k++) {                  // inside the D, spiralling out from its middle
    const a = k * 2.4, rr = D.r * 0.9 * Math.sqrt(k / 40), x = D.x - Math.abs(Math.cos(a)) * rr - 0.01, z = Math.sin(a) * rr;
    if (isFree(G, x, z, b)) { Object.assign(b, { x, z, vx: 0, vz: 0, on: true, drop: 0 }); return; }
  }
  Object.assign(b, { x: D.x - D.r * 0.5, z: 0, vx: 0, vz: 0, on: true, drop: 0 });
}
// When everything has come to rest: score what went down, re-spot colours (while reds remain) and the cue ball.
export function settle(G) {
  const res = { reds: 0, colours: 0, points: 0, scratch: false, done: false };
  const fresh = G.fresh.splice(0), redsLeft = G.balls.some(b => b.kind === 'red' && b.on) || fresh.some(b => b.kind === 'red');
  for (const b of fresh) {
    if (b.kind === 'cue') { res.scratch = true; continue; }
    res.points += b.value; G.potted++;
    if (b.kind === 'red') res.reds++; else { res.colours++; if (redsLeft) respot(G, b); }
  }
  if (res.scratch) { res.points -= 4; respawnCue(G, G.balls[0]); }
  G.score = Math.max(0, G.score + res.points);
  G.done = res.done = !G.balls.some(b => b.on && b.kind !== 'cue');
  return res;
}
export function shoot(G, angle, power) {
  const c = G.balls[0]; if (!c.on || G.moving) return false;
  const v = 0.35 + Math.max(0, Math.min(1, power)) * (VMAX - 0.35);
  c.vx = Math.cos(angle) * v; c.vz = Math.sin(angle) * v; G.moving = true; G.shots++;
  return true;
}
// First thing the cue ball meets along `angle`: {x, z (cue-ball centre at contact), ball | null, t}
export function aimTrace(G, angle) {
  const c = G.balls[0], dx = Math.cos(angle), dz = Math.sin(angle), X = G.PL / 2 - G.r, Z = G.PW / 2 - G.r;
  let t = 1e9, ball = null;
  if (dx > 1e-9) t = Math.min(t, (X - c.x) / dx); else if (dx < -1e-9) t = Math.min(t, (-X - c.x) / dx);
  if (dz > 1e-9) t = Math.min(t, (Z - c.z) / dz); else if (dz < -1e-9) t = Math.min(t, (-Z - c.z) / dz);
  for (const b of G.balls) {
    if (b === c || !b.on) continue;
    const ox = b.x - c.x, oz = b.z - c.z, p = ox * dx + oz * dz; if (p <= 0) continue;
    const q = ox * ox + oz * oz - p * p, rr = 4 * G.r * G.r; if (q >= rr) continue;
    const tt = p - Math.sqrt(rr - q);
    if (tt > 0 && tt < t) { t = tt; ball = b; }
  }
  t = Math.max(0, t);
  return { x: c.x + dx * t, z: c.z + dz * t, ball, t };
}
function autoAim(G) {
  // a red first while any is left — the nearest one the cue ball can reach in a straight line; then the colours in order
  const c = G.balls[0], reds = G.balls.some(b => b.on && b.kind === 'red');
  const cand = G.balls.filter(b => b !== c && b.on && (!reds || b.kind === 'red'))
    .sort((p, q) => reds ? Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z) : p.value - q.value);
  if (!cand.length) return 0;
  const ang = (b) => Math.atan2(b.z - c.z, b.x - c.x);
  const clear = cand.find(b => { const hit = aimTrace(G, ang(b)).ball; return hit && (reds ? hit.kind === 'red' : hit === b); });
  return ang(clear || cand[0]);
}

// ================================================================== UI strings (8 languages)
const T = {
  en: { play: 'Play snooker', exit: 'Exit', rerack: 'Re-rack', chalk: 'Chalk', score: 'Score', potted: 'Potted', power: 'Power', sound: 'Sound',
    hintTouch: 'Drag to aim · pull the power bar down and release to shoot', hintKey: 'Drag or ←/→ to aim · pull the power bar (or hold Space) and release to shoot',
    scratch: 'Cue ball potted — back in the D', done: 'Table cleared! New frame…' },
  he: { play: 'שחקו סנוקר', exit: 'יציאה', rerack: 'סידור מחדש', chalk: 'גיר', score: 'ניקוד', potted: 'בכיסים', power: 'עוצמה', sound: 'צליל',
    hintTouch: 'גררו כדי לכוון · משכו את מד העוצמה מטה ושחררו להכאה', hintKey: 'גררו או ←/→ כדי לכוון · משכו את מד העוצמה (או החזיקו רווח) ושחררו להכאה',
    scratch: 'הכדור הלבן נפל לכיס — חוזר לחצי העיגול', done: 'השולחן נוקה! משחק חדש…' },
  ro: { play: 'Joacă snooker', exit: 'Ieșire', rerack: 'Reașază bilele', chalk: 'Cretă', score: 'Scor', potted: 'Introduse', power: 'Forță', sound: 'Sunet',
    hintTouch: 'Trage pentru a ținti · trage bara de forță în jos și eliberează pentru a lovi', hintKey: 'Trage sau ←/→ pentru a ținti · trage bara de forță (sau ține Space) și eliberează pentru a lovi',
    scratch: 'Bila albă a intrat în buzunar — revine în „D”', done: 'Masă curățată! Joc nou…' },
  ru: { play: 'Сыграть в снукер', exit: 'Выйти', rerack: 'Расставить заново', chalk: 'Мел', score: 'Счёт', potted: 'Забито', power: 'Сила', sound: 'Звук',
    hintTouch: 'Ведите пальцем, чтобы прицелиться · потяните шкалу силы вниз и отпустите для удара', hintKey: 'Тяните мышью или ←/→ для прицела · потяните шкалу силы (или удерживайте пробел) и отпустите для удара',
    scratch: 'Биток в лузе — возвращён в сектор «D»', done: 'Стол очищен! Новая партия…' },
  uk: { play: 'Зіграти в снукер', exit: 'Вийти', rerack: 'Розставити заново', chalk: 'Крейда', score: 'Рахунок', potted: 'Забито', power: 'Сила', sound: 'Звук',
    hintTouch: 'Ведіть пальцем, щоб прицілитися · потягніть шкалу сили вниз і відпустіть для удару', hintKey: 'Тягніть мишею або ←/→ для прицілу · потягніть шкалу сили (або утримуйте пробіл) і відпустіть для удару',
    scratch: 'Биток у лузі — повернуто в сектор «D»', done: 'Стіл очищено! Нова партія…' },
  fr: { play: 'Jouer au snooker', exit: 'Quitter', rerack: 'Replacer les billes', chalk: 'Craie', score: 'Score', potted: 'Empochées', power: 'Puissance', sound: 'Son',
    hintTouch: 'Glissez pour viser · tirez la jauge de puissance vers le bas puis relâchez pour tirer', hintKey: 'Glissez ou ←/→ pour viser · tirez la jauge (ou maintenez Espace) puis relâchez pour tirer',
    scratch: 'Bille blanche empochée — replacée dans le « D »', done: 'Table nettoyée ! Nouvelle partie…' },
  it: { play: 'Gioca a snooker', exit: 'Esci', rerack: 'Riposiziona le bilie', chalk: 'Gesso', score: 'Punteggio', potted: 'Imbucate', power: 'Potenza', sound: 'Audio',
    hintTouch: 'Trascina per mirare · tira giù la barra della potenza e rilascia per colpire', hintKey: 'Trascina o ←/→ per mirare · tira la barra della potenza (o tieni premuto Spazio) e rilascia per colpire',
    scratch: 'Bilia bianca in buca — rimessa nella «D»', done: 'Tavolo ripulito! Nuova partita…' },
  de: { play: 'Snooker spielen', exit: 'Beenden', rerack: 'Neu aufbauen', chalk: 'Kreide', score: 'Punkte', potted: 'Versenkt', power: 'Stoßkraft', sound: 'Ton',
    hintTouch: 'Ziehen zum Zielen · Kraftregler nach unten ziehen und loslassen zum Stoßen', hintKey: 'Ziehen oder ←/→ zum Zielen · Kraftregler ziehen (oder Leertaste halten) und loslassen zum Stoßen',
    scratch: 'Weiße versenkt — zurück ins „D“', done: 'Tisch abgeräumt! Neuer Frame…' },
};
export const SNOOKER_I18N = T;
const CSS = `
.vw.vw-snk .vw-hud{display:none}
.snk{position:absolute;inset:0;z-index:40;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;font:500 14px/1.25 Manrope,Heebo,system-ui,sans-serif;color:#f4ead2}
.snk.drag{cursor:grabbing}
.snk-top{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 0;pointer-events:none}
.snk-score,.snk-btns button,.snk-power,.snk-hint,.snk-msg,.snk-play{background:rgba(12,11,9,.72);border:1px solid rgba(201,164,92,.55);border-radius:12px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.snk-score{padding:7px 14px;display:flex;align-items:baseline;gap:8px;pointer-events:none}
.snk-score b{font:600 26px/1 "Cormorant Garamond",serif;color:#f0d596;min-width:1.2em;text-align:center}
.snk-score span{opacity:.85}.snk-score i{font-style:normal;opacity:.7;border-inline-start:1px solid rgba(201,164,92,.4);padding-inline-start:8px}
.snk-btns{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;pointer-events:auto}
.snk-btns button,.snk-play{color:inherit;font:inherit;padding:9px 13px;min-height:40px;cursor:pointer}
.snk-btns button:active,.snk-play:active{background:rgba(201,164,92,.3)}
.snk-btns button[data-a=exit]{background:linear-gradient(180deg,#e7c97f,#b88a3c);color:#17120a;border-color:#f0d596;font-weight:700}
.snk-btns button[data-a=sound]{min-width:40px;padding:9px 10px}.snk-btns button[data-a=sound].off{opacity:.5;text-decoration:line-through}
.snk-power{position:absolute;inset-inline-end:12px;top:50%;transform:translateY(-46%);width:58px;height:min(46%,300px);padding:10px 0 26px;display:flex;flex-direction:column;align-items:center;cursor:ns-resize;touch-action:none}
.snk-power span{position:absolute;bottom:6px;font-size:11px;letter-spacing:.04em;opacity:.8;pointer-events:none}
.snk-track{position:relative;flex:1;width:14px;border-radius:8px;background:rgba(255,255,255,.12);overflow:visible;pointer-events:none}
.snk-fill{position:absolute;left:0;right:0;top:0;height:0;border-radius:8px;background:linear-gradient(180deg,#f0d596,#e08a2c 70%,#c8321f)}
.snk-knob{position:absolute;left:50%;top:0;width:40px;height:22px;margin:-11px 0 0 -20px;border-radius:11px;background:linear-gradient(180deg,#f3dca0,#b88a3c);box-shadow:0 2px 8px rgba(0,0,0,.5)}
.snk-hint{position:absolute;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);max-width:min(86%,560px);padding:8px 14px;text-align:center;font-size:13px;pointer-events:none;transition:opacity .4s}
.snk-msg{position:absolute;left:50%;top:22%;transform:translateX(-50%);padding:10px 18px;font-size:15px;color:#f0d596;pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap}
.snk-msg.show{opacity:1}
.snk.roll .snk-power{opacity:.35}.snk.roll .snk-hint{opacity:0}
.snk-play{position:absolute;left:50%;bottom:calc(150px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:6;display:none;background:linear-gradient(180deg,#e7c97f,#b88a3c);color:#17120a;border-color:#f0d596;font:700 15px/1 Manrope,Heebo,system-ui,sans-serif;padding:12px 20px;box-shadow:0 6px 22px rgba(0,0,0,.45)}
.snk-play.show{display:block}
.vw.vw-snk .snk-play,.vw.riding .snk-play,.vw.m360 .snk-play{display:none}
@media (max-width:520px){.snk-btns button{padding:8px 10px;font-size:13px}.snk-score b{font-size:22px}.snk-power{width:52px}}
`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

// ================================================================== model helpers
const TG = new Map();
function tinted(geo, hex) {
  const k = geo.uuid + hex; let t = TG.get(k);
  if (!t) { t = geo.clone(); const c = new THREE.Color(hex), n = t.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } t.setAttribute('color', new THREE.BufferAttribute(a, 3)); TG.set(k, t); }
  return t;
}
const tint = (o, hex) => { o.geometry = tinted(o.geometry, hex); return o; };
const GEO = new Map();
const cached = (k, f) => { let g = GEO.get(k); if (!g) { g = f(); GEO.set(k, g); } return g; };
const BAIZE = '#1d6b47';
let PIT = null;                                    // pocket holes: unlit black (a lit dark disc reads grey under the pendant)
// rail frame: rounded outer rectangle with ONE hole = the bed (to the back of the cushions) plus the six pocket bulges
function railGeo(size) {
  return cached('rail' + size, () => {
    const { PL, PW } = TABLES[size], a = PL / 2 + CUSH, b = PW / 2 + CUSH, HX = a + RAIL, HZ = b + RAIL, cr = 0.045;
    const sh = new THREE.Shape();
    sh.moveTo(-HX + cr, -HZ); sh.lineTo(HX - cr, -HZ); sh.absarc(HX - cr, -HZ + cr, cr, -HALF, 0, false); sh.lineTo(HX, HZ - cr); sh.absarc(HX - cr, HZ - cr, cr, 0, HALF, false);
    sh.lineTo(-HX + cr, HZ); sh.absarc(-HX + cr, HZ - cr, cr, HALF, Math.PI, false); sh.lineTo(-HX, -HZ + cr); sh.absarc(-HX + cr, -HZ + cr, cr, Math.PI, Math.PI * 1.5, false);
    const pk = pocketMarks(size), angs = new Set();
    for (let i = 0; i < 64; i++) angs.add(+(i / 64 * Math.PI * 2).toFixed(5));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) angs.add(+((Math.atan2(sz * b, sx * a) + Math.PI * 2) % (Math.PI * 2)).toFixed(5));
    for (const [px, pz, pr] of pk) { const d = Math.hypot(px, pz), w = Math.asin(Math.min(1, pr / d)) * 1.12, c = Math.atan2(pz, px); for (let i = 0; i <= 36; i++) angs.add(+(((c - w + 2 * w * i / 36) + Math.PI * 4) % (Math.PI * 2)).toFixed(5)); }
    const pts = [...angs].sort((p, q) => p - q).map(th => {
      const dx = Math.cos(th), dz = Math.sin(th);
      let rho = Math.min(Math.abs(dx) > 1e-9 ? a / Math.abs(dx) : 1e9, Math.abs(dz) > 1e-9 ? b / Math.abs(dz) : 1e9);
      for (const [px, pz, pr] of pk) { const p = px * dx + pz * dz, q = px * px + pz * pz - p * p; if (p > 0 && q < pr * pr) rho = Math.max(rho, p + Math.sqrt(pr * pr - q)); }
      return new THREE.Vector2(dx * rho, dz * rho);
    });
    sh.holes.push(new THREE.Path(pts));
    const g = new THREE.ExtrudeGeometry(sh, { depth: RAILH + 0.006, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(HALF);                               // shape (x, y) → (x, z), extrusion → −y; top face ends at y = 0
    g.translate(0, RAILH + 0.006, 0);
    return g;
  });
}
// pocket holes as seen in the rail / on the bed: [x, z, radius]
function pocketMarks(size) {
  const { PL, PW } = TABLES[size], X = PL / 2, Z = PW / 2;
  return [[-X - 0.02, -Z - 0.02, 0.068], [X + 0.02, -Z - 0.02, 0.068], [-X - 0.02, Z + 0.02, 0.068], [X + 0.02, Z + 0.02, 0.068], [0, -Z - 0.045, 0.058], [0, Z + 0.045, 0.058]];
}
function cueGeo() {
  return cached('cue', () => {
    // tip at the origin, shaft towards −x: blue chalked tip, ivory ferrule, maple shaft, ebony butt with a brass ring
    const seg = (r0, r1, x0, x1, hex) => { const g = new THREE.CylinderGeometry(r1, r0, x1 - x0, 10, 1, false).toNonIndexed(); g.rotateZ(HALF); g.translate(-(x0 + x1) / 2, 0, 0); g.deleteAttribute('uv'); return tinted(g, hex).clone(); };
    const parts = [seg(0.0048, 0.005, 0, 0.007, '#3d74c9'), seg(0.005, 0.0052, 0.007, 0.03, '#efe9da'), seg(0.0052, 0.0105, 0.03, 0.98, '#d8b47c'),
      seg(0.0105, 0.011, 0.98, 0.992, '#c9a45c'), seg(0.011, 0.0145, 0.992, 1.44, '#231712'), seg(0.0145, 0.013, 1.44, 1.455, '#111111')];
    const g = mergeGeometries(parts); parts.forEach(p => p.dispose()); return g;
  });
}
const ballGeo = () => cached('ball', () => { const g = new THREE.SphereGeometry(R, 22, 15); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; });
const chalkGeo = () => cached('chalk', () => {
  const a = tinted(new THREE.BoxGeometry(0.024, 0.02, 0.024).toNonIndexed(), '#e9e2cf').clone(), b = tinted(new THREE.BoxGeometry(0.0205, 0.004, 0.0205).translate(0, 0.0105, 0).toNonIndexed(), '#2c63c0').clone();
  const g = mergeGeometries([a, b]); g.deleteAttribute('uv'); return g;
});

// Floor stand: four cues, the triangle on its hook, spare chalk. Static (baked). Front = +z.
export function buildCueRack(m) {
  const g = new THREE.Group(), wood = m.fam === 'nordic' ? m.woodLight : m.woodDark, W = 0.52;
  FX.box(g, W, 0.05, 0.24, wood, 0, 0, 0);
  for (const sx of [-1, 1]) FX.box(g, 0.035, 0.98, 0.05, wood, sx * (W / 2 - 0.02), 0.05, -0.08);
  FX.box(g, W, 0.045, 0.07, wood, 0, 0.94, -0.06);
  FX.box(g, W - 0.04, 0.006, 0.012, m.metal, 0, 0.05, 0.115);
  for (let i = 0; i < 4; i++) {
    const x = -0.165 + i * 0.11, c = new THREE.Mesh(cueGeo(), m.goods);
    c.rotation.set(-0.07, 0, HALF); c.position.set(x, 0.05 + 1.452, -0.057); g.add(c);     // tip up, leaning on the top rail
    FX.cyl(g, 0.02, 0.02, 0.006, m.darkPlastic, x, 0.05, 0.044, 12);
    FX.torus(g, 0.014, 0.004, m.metal, x, 0.9625, -0.019, [HALF, 0, 0], Math.PI * 2, 12);
  }
  // triangle on the side of the stand, chalk on the base
  const tr = FX.grp(g, W / 2 + 0.012, 0.52, -0.02); tr.rotation.set(0, HALF, 0);
  const s = 0.31, th = 0.014; for (let i = 0; i < 3; i++) { const q = FX.grp(tr, 0, 0, 0); q.rotation.z = i * Math.PI * 2 / 3; FX.box(q, s, 0.022, th, wood, 0, -s * 0.2887 - 0.011, 0); }
  FX.cyl(g, 0.006, 0.006, 0.03, m.metal, W / 2 + 0.006, 0.7, -0.02, 8, [0, 0, HALF]);
  for (const [x, hex] of [[-0.215, '#2c63c0'], [0.22, '#2c63c0']]) tint(FX.box(g, 0.022, 0.02, 0.022, m.goods, x, 0.05, 0.08), hex);
  g.userData.noSolid = true; g.userData.ao = { w: W, d: 0.26 };
  return g;
}

// ================================================================== the table
export function buildSnookerTable(m, o = {}) {
  const size = TABLES[o.size] ? o.size : 8, { PL, PW } = TABLES[size], CHt = o.ceiling || 2.7;
  const HX = PL / 2 + CUSH + RAIL, HZ = PW / 2 + CUSH + RAIL, g = new THREE.Group(), slab = m.fam === 'milano';
  const wood = m.fam === 'nordic' ? m.woodLight : m.woodDark;
  // bed + cushions (baize = the tinted cloth material), pocket holes, rail frame with sights
  tint(FX.box(g, PL + 2 * CUSH + 0.02, 0.02, PW + 2 * CUSH + 0.02, m.clothes, 0, BED - 0.02, 0), BAIZE);
  const cu = (x0, x1, z0, z1) => tint(FX.box(g, x1 - x0, 0.034, z1 - z0, m.clothes, (x0 + x1) / 2, BED, (z0 + z1) / 2), '#1a6040');
  for (const sz of [-1, 1]) { const za = sz * PW / 2, zb = sz * (PW / 2 + CUSH); cu(-PL / 2 + 0.072, -0.062, Math.min(za, zb), Math.max(za, zb)); cu(0.062, PL / 2 - 0.072, Math.min(za, zb), Math.max(za, zb)); }
  for (const sx of [-1, 1]) { const xa = sx * PL / 2, xb = sx * (PL / 2 + CUSH); cu(Math.min(xa, xb), Math.max(xa, xb), -PW / 2 + 0.072, PW / 2 - 0.072); }
  if (!PIT) { PIT = new THREE.MeshBasicMaterial({ color: 0x040404 }); PIT.name = 'snooker.pit'; }
  for (const [px, pz, pr] of pocketMarks(size)) { FX.disc(g, pr + 0.004, PIT, px, BED + 0.0016, pz, [-HALF, 0, 0], 20); }
  const rail = new THREE.Mesh(railGeo(size), wood); rail.position.y = BED; g.add(rail);
  for (const sz of [-1, 1]) for (const k of [-3, -2, -1, 1, 2, 3]) FX.disc(g, 0.0065, m.porcelain, k * PL / 8, BED + RAILH + 0.0068, sz * (PW / 2 + CUSH + RAIL * 0.5), [-HALF, 0, 0], 10);
  for (const sx of [-1, 1]) for (const k of [-1, 0, 1]) FX.disc(g, 0.0065, m.porcelain, sx * (PL / 2 + CUSH + RAIL * 0.5), BED + RAILH + 0.0068, k * PW / 4, [-HALF, 0, 0], 10);
  // body: frame, stepped apron with a metal line, legs
  FX.box(g, 2 * HX - 0.03, 0.16, 2 * HZ - 0.03, wood, 0, BED - 0.18, 0);
  FX.box(g, 2 * HX - 0.022, 0.008, 2 * HZ - 0.022, m.metal, 0, BED - 0.186, 0);
  FX.box(g, 2 * HX - 0.14, 0.1, 2 * HZ - 0.14, wood, 0, BED - 0.28, 0);
  const legH = BED - 0.28;
  if (slab) for (const sx of [-1, 1]) { FX.box(g, 0.16, legH - 0.02, 2 * HZ - 0.36, wood, sx * (HX - 0.46), 0.02, 0); FX.box(g, 0.2, 0.02, 2 * HZ - 0.32, m.metal, sx * (HX - 0.46), 0, 0); }
  else for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (HX - 0.2), lz = sz * (HZ - 0.2);
    if (m.styleId === 'paris') FX.lathe(g, [[0, 0], [0.035, 0], [0.04, 0.03], [0.03, 0.07], [0.048, 0.22], [0.06, 0.34], [0.045, 0.4], [0.07, 0.44], [0.07, legH], [0, legH]], wood, lx, 0, lz, 16);
    else { FX.cyl(g, 0.062, 0.036, legH - 0.02, wood, lx, 0.02, lz, 14); FX.cyl(g, 0.04, 0.04, 0.02, m.metal, lx, 0, lz, 14); }
  }
  // pendant: a bar on two rods with three shades over the bed (the shades' rims stay above 1.66 m: the play camera
  // always looks from below them)
  if (!o.cut) {
    const yBar = 2.04, bl = PL * 0.62, yS = 1.68, shade = m.fam === 'nordic' ? m.blackMetal : m.fam === 'milano' ? m.brass : null;
    FX.box(g, 0.5, 0.02, 0.08, m.metal, 0, CHt - 0.02, 0);
    for (const sx of [-1, 1]) FX.rod(g, 0.006, CHt - yBar, m.metal, sx * 0.22, (CHt + yBar) / 2, 0, null, 8);
    FX.box(g, bl + 0.1, 0.026, 0.026, m.metal, 0, yBar - 0.013, 0);
    for (const k of [-1, 0, 1]) {
      const x = k * bl / 2;
      FX.rod(g, 0.004, yBar - yS - 0.2, m.metal, x, (yBar + yS + 0.2) / 2, 0, null, 6);
      const pts = [[0.172, 0], [0.165, 0.03], [0.05, 0.2], [0.028, 0.22]];
      const sh = FX.lathe(g, pts, shade || m.goods, x, yS, 0, 24); if (!shade) tint(sh, '#0f4a34');
      FX.disc(g, 0.15, m.lightEmit, x, yS + 0.045, 0, [HALF, 0, 0], 20);
      FX.bloom(g, x, yS + 0.02, 0, 0.42, 0.7);
    }
    FX.fxFlat(g, m.glowFaint, 'rect', 0, BED + 0.004, 0, PL * 1.02, PW * 1.3);
  }
  // walking collider: apartment.js makes it from solidBox. The tap proxy below is a hair larger, so a tap meets it first,
  // while walking / gliding only ever meets the plain collider (no "tap the door" hint in front of the table).
  g.userData.solidBox = { w: 2 * HX, d: 2 * HZ, h: BED + RAILH - 0.01 }; g.userData.ao = { w: 2 * HX - 0.2, d: 2 * HZ - 0.2 };

  // ---------------- live parts
  const dyn = FX.grp(g, 0, 0, 0); dyn.userData.keep = true; dyn.name = 'snooker-dyn';
  const G = createGame(size);
  const balls = new THREE.InstancedMesh(ballGeo(), m.goods, G.balls.length);
  balls.name = 'snooker-balls'; balls.frustumCulled = false; balls.raycast = () => {}; dyn.add(balls);
  const cue = new THREE.Mesh(cueGeo(), m.goods); cue.name = 'snooker-cue'; cue.raycast = () => {}; cue.rotation.order = 'YZX'; dyn.add(cue);
  const chalk = new THREE.Mesh(chalkGeo(), m.goods); chalk.name = 'snooker-chalk'; chalk.raycast = () => {}; dyn.add(chalk);
  const proxy = (part, w, h, d, x, y, z) => {
    const px = new THREE.Mesh(BOX(), m.collider); px.scale.set(w, h, d); px.position.set(x, y + h / 2, z); px.name = 'snooker-' + part;
    px.userData.playPart = part; px.userData.piece = 'snooker'; px.userData.open = false;
    dyn.add(px); return px;
  };
  const tablePx = proxy('snooker', 2 * HX + 0.024, BED + RAILH + 0.004, 2 * HZ + 0.024, 0, 0, 0);
  const yRail = BED + RAILH + 0.006, zRail = PW / 2 + CUSH + RAIL * 0.5;
  const chalkRest = new THREE.Vector3(-PL * 0.36, yRail + 0.01, zRail), cueRest = { p: new THREE.Vector3(-PL * 0.3, yRail + 0.0055, zRail - 0.012), yaw: Math.PI, pitch: -0.0066 };
  const chalkPx = proxy('chalk', 0.09, 0.07, 0.09, chalkRest.x, yRail, chalkRest.z);
  g.userData.game = controller({ m, G, size, PL, PW, HX, HZ, dyn, balls, cue, chalk, tablePx, chalkPx, chalkRest, cueRest });
  return g;
}
const BOX = () => cached('ubox', () => new THREE.BoxGeometry(1, 1, 1));

// ================================================================== controller (room prompt + play mode)
function controller(K) {
  const { m, G, PL, PW, HX, dyn, balls, cue, chalk, tablePx, chalkPx, chalkRest, cueRest } = K;
  const S = { playing: false, want: false, exiting: false, blend: 0, state: 'aim', angle: 0, power: 0, strike: 0, charge: null, walker: null,
    cp: new THREE.Vector3(), ct: new THREE.Vector3(), shotFrom: null, keys: new Set(), sound: lsGet('vrc.walk.gameSound') !== 'off', chalking: false,
    promptT: 0, lastSnd: 0, msgT: 0, rerackT: 0, err: false, drag: null, hud: '' };
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P3 = new THREE.Vector3(), S3 = new THREE.Vector3(), col = new THREE.Color();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), wPos = new THREE.Vector3(), wQuat = new THREE.Quaternion(), pQuat = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  let ui = null, prompt = null, guide = null, puff = null, disposed = false;

  const sync = () => {
    G.balls.forEach((b, i) => {
      const k = b.on ? 1 : Math.max(1e-4, b.drop);
      M4.compose(P3.set(b.x, BED + R - (b.on ? 0 : (1 - b.drop) * 0.06), b.z), Q.identity(), S3.setScalar(k)); balls.setMatrixAt(i, M4);
    });
    balls.instanceMatrix.needsUpdate = true;
  };
  const paint = () => { G.balls.forEach((b, i) => balls.setColorAt(i, col.set(b.color))); balls.instanceColor.needsUpdate = true; };
  const restCue = () => { cue.visible = true; cue.position.copy(cueRest.p); cue.rotation.set(0, cueRest.yaw, cueRest.pitch); };
  paint(); sync(); restCue(); chalk.position.copy(chalkRest); chalk.rotation.set(0, 0.5, 0);

  const t = (k) => { const l = String((S.walker && S.walker.lang) || (typeof document !== 'undefined' && document.documentElement.lang) || 'en').slice(0, 2); return (T[l] || T.en)[k] || T.en[k]; };
  const dirOf = (w) => { try { return w.dir === 'rtl' ? 'rtl' : 'ltr'; } catch { return 'ltr'; } };
  const cueTip = (out) => out.set(-0.0035, 0, 0).applyEuler(cue.rotation).add(cue.position);

  // ---- sounds (WebAudio through the walkthrough's context; silent until the visitor has interacted / if muted)
  const snd = (kind, v) => {
    const w = S.walker; if (!S.sound || !w || w.soundOn === false || typeof w._audio !== 'function') return;
    const now = performance.now(); if (now - S.lastSnd < 28) return; S.lastSnd = now;
    const ac = w._audio(); if (!ac) return;
    try {
      const t0 = ac.currentTime + 0.003, vol = Math.min(1, v / 2.6);
      if (kind === 'hit') {
        const o = ac.createOscillator(), og = ac.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(2300 + Math.random() * 300, t0);
        og.gain.setValueAtTime(0.05 + 0.2 * vol, t0); og.gain.exponentialRampToValueAtTime(0.0002, t0 + 0.035); o.connect(og).connect(ac.destination); o.start(t0); o.stop(t0 + 0.04);
        const n = Math.floor(ac.sampleRate * 0.012), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = ac.createBufferSource(), ng = ac.createGain(); src.buffer = buf; ng.gain.value = 0.06 + 0.2 * vol; src.connect(ng).connect(ac.destination); src.start(t0);
      } else {
        const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; const f = kind === 'pot' ? 150 : kind === 'cue' ? 420 : 240;
        o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 0.55, t0 + 0.09);
        og.gain.setValueAtTime(kind === 'pot' ? 0.3 : 0.06 + 0.16 * vol, t0); og.gain.exponentialRampToValueAtTime(0.0003, t0 + (kind === 'pot' ? 0.22 : 0.1)); o.connect(og).connect(ac.destination); o.start(t0); o.stop(t0 + 0.25);
      }
    } catch { /* optional */ }
  };

  // ---- DOM
  const ensureCss = (root) => { if (root.querySelector('style[data-snk]')) return; const st = document.createElement('style'); st.dataset.snk = '1'; st.textContent = CSS; root.appendChild(st); };
  const showMsg = (text, ms = 2200) => { if (!ui) return; const e = ui.querySelector('.snk-msg'); e.textContent = text; e.classList.add('show'); clearTimeout(S.msgT); S.msgT = setTimeout(() => e.classList.remove('show'), ms); };
  const hud = () => {
    if (!ui) return; const key = G.score + '|' + G.potted + '|' + S.state + '|' + S.sound;
    if (key === S.hud) return; S.hud = key;
    ui.querySelector('.snk-score b').textContent = G.score; ui.querySelector('.snk-score i').textContent = `${t('potted')} ${G.potted}`;
    ui.classList.toggle('roll', S.state !== 'aim'); ui.querySelector('[data-a=sound]').classList.toggle('off', !S.sound);
  };
  const setPower = (p) => { S.power = Math.max(0, Math.min(1, p)); if (!ui) return; ui.querySelector('.snk-fill').style.height = (S.power * 100).toFixed(1) + '%'; ui.querySelector('.snk-knob').style.top = (S.power * 100).toFixed(1) + '%'; };
  const buildUi = (w) => {
    ensureCss(w.root);
    ui = document.createElement('div'); ui.className = 'snk'; ui.dir = dirOf(w);
    ui.innerHTML = `<div class="snk-top"><div class="snk-score"><b>0</b><span></span><i></i></div><div class="snk-btns"><button data-a="chalk"></button><button data-a="rerack"></button><button data-a="sound" aria-label="">♪</button><button data-a="exit"></button></div></div>
      <div class="snk-power"><div class="snk-track"><div class="snk-fill"></div><div class="snk-knob"></div></div><span></span></div><div class="snk-hint"></div><div class="snk-msg"></div>`;
    ui.querySelector('.snk-score span').textContent = t('score');
    for (const k of ['chalk', 'rerack', 'exit']) ui.querySelector(`[data-a=${k}]`).textContent = t(k);
    const sb = ui.querySelector('[data-a=sound]'); sb.title = t('sound'); sb.setAttribute('aria-label', t('sound'));
    ui.querySelector('.snk-power span').textContent = t('power');
    ui.querySelector('.snk-hint').textContent = t(w._isTouch || w._phone ? 'hintTouch' : 'hintKey');
    ui.addEventListener('pointerdown', onDown); ui.addEventListener('pointermove', onMove); ui.addEventListener('pointerup', onUp); ui.addEventListener('pointercancel', onUp);
    ui.addEventListener('contextmenu', ev => ev.preventDefault());
    ui.addEventListener('click', ev => {
      const b = ev.target.closest && ev.target.closest('button[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'exit') exit(); else if (a === 'rerack') rerack(); else if (a === 'chalk') chalkUp();
      else if (a === 'sound') { S.sound = !S.sound; lsSet('vrc.walk.gameSound', S.sound ? 'on' : 'off'); hud(); if (S.sound) snd('hit', 1.2); }
    });
    w.root.appendChild(ui);
  };
  const tablePoint = (ev, out) => {                // pointer → point on the bed plane (table frame), or null
    const w = S.walker, r = w.canvas.getBoundingClientRect(), ray = w._ray || new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), w.camera);
    M4.copy(dyn.matrixWorld).invert(); v1.copy(ray.ray.origin).applyMatrix4(M4); v2.copy(ray.ray.direction).transformDirection(M4);
    if (v2.y > -1e-4) return null;
    const k = (BED + R - v1.y) / v2.y; return out.copy(v1).addScaledVector(v2, k);
  };
  const onDown = (ev) => {
    if (ev.target.closest && ev.target.closest('button')) return;
    try { ui.setPointerCapture(ev.pointerId); } catch { /* */ }
    if (S.walker && S.walker._audio) S.walker._audio();
    if (S.state !== 'aim' || S.chalking) return;
    const pw = ev.target.closest && ev.target.closest('.snk-power');
    S.drag = { id: ev.pointerId, pw: !!pw, x: ev.clientX, y: ev.clientY, a0: S.angle, moved: 0, t: ev.timeStamp || performance.now(), touch: ev.pointerType === 'touch', fine: ev.shiftKey };
    if (pw) powerAt(ev); else ui.classList.add('drag');
  };
  const powerAt = (ev) => { const r = ui.querySelector('.snk-track').getBoundingClientRect(); setPower((ev.clientY - r.top) / Math.max(1, r.height)); };
  const onMove = (ev) => {
    const d = S.drag; if (!d || d.id !== ev.pointerId) return;
    if (d.pw) return powerAt(ev);
    d.moved = Math.max(d.moved, Math.hypot(ev.clientX - d.x, ev.clientY - d.y));
    if (d.moved > 5) S.angle = d.a0 + (ev.clientX - d.x) * (d.fine || ev.shiftKey ? 0.0009 : d.touch ? 0.0042 : 0.0034);
  };
  const onUp = (ev) => {
    const d = S.drag; if (!d || d.id !== ev.pointerId) return;
    S.drag = null; ui.classList.remove('drag');
    if (ev.type === 'pointercancel') { if (d.pw) setPower(0); return; }
    if (d.pw) { if (S.power > 0.03) fire(); else setPower(0); return; }
    if (d.moved < 6 && (ev.timeStamp || performance.now()) - d.t < 450) {       // tap on the bed: aim through that point
      const p = tablePoint(ev, new THREE.Vector3()), c = G.balls[0];
      if (p && Math.abs(p.x) < PL / 2 + 0.3 && Math.abs(p.z) < PW / 2 + 0.3 && Math.hypot(p.x - c.x, p.z - c.z) > 0.03) S.angle = Math.atan2(p.z - c.z, p.x - c.x);
    }
  };
  const onKey = (ev) => {
    if (!S.playing || S.exiting) return;
    const tg = ev.target; if (tg && tg.closest && tg.closest('input,textarea,select,[contenteditable="true"]')) return;
    const c = ev.code, down = ev.type === 'keydown';
    ev.stopPropagation();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(c)) ev.preventDefault();
    if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD' || c === 'ShiftLeft' || c === 'ShiftRight') { if (down) S.keys.add(c); else S.keys.delete(c); return; }
    if (c === 'Space') {
      if (down && !ev.repeat && S.state === 'aim' && !S.chalking) S.charge = performance.now();
      else if (!down && S.charge != null) { S.charge = null; if (S.power > 0.03) fire(); else setPower(0); }
      return;
    }
    if (!down || ev.repeat) return;
    if (c === 'Escape') exit(); else if (c === 'KeyR') rerack(); else if (c === 'KeyC') chalkUp();
  };

  // ---- game flow
  const fire = () => { if (S.state !== 'aim' || S.chalking || !G.balls[0].on) return; S.state = 'strike'; S.strike = 0; S.shotPower = S.power; };
  const rerack = () => { clearTimeout(S.rerackT); rack(G); paint(); sync(); S.state = 'aim'; S.angle = autoAim(G); setPower(0); S.shotFrom = null; hud(); };
  const afterShot = () => {
    const res = settle(G); sync();
    if (res.scratch) showMsg(t('scratch'));
    if (res.done) { showMsg(t('done'), 3200); clearTimeout(S.rerackT); S.rerackT = setTimeout(() => { if (!disposed) rerack(); }, 3200); }
    S.state = 'aim'; S.angle = autoAim(G); setPower(0); S.shotFrom = null;
    return res;
  };
  const simulate = (dt) => {
    if (S.state === 'strike') {                    // the cue drives through, then the ball leaves
      S.strike += dt / 0.11;
      if (S.strike >= 1) { shoot(G, S.angle, S.shotPower); S.shotFrom = { x: G.balls[0].x, z: G.balls[0].z }; S.state = 'roll'; S.rollT = 0; snd('cue', 0.8 + S.shotPower * 2); }
    }
    if (S.state === 'roll') {
      S.rollT += dt;
      const moving = step(G, dt);
      for (const e of G.events.splice(0)) snd(e.t, e.v || 1);
      if (!moving || S.rollT > 30) { if (moving) for (const b of G.balls) b.vx = b.vz = 0; G.moving = false; afterShot(); }
    }
    let dropping = false; for (const b of G.balls) if (!b.on && b.drop > 0) { b.drop = Math.max(0, b.drop - dt / 0.22); dropping = true; }
    if (S.state === 'roll' || dropping) sync();
  };
  const poseCue = () => {
    const c = G.balls[0];
    if (S.chalking) return;
    if (S.state === 'roll') { cue.visible = S.rollT < 0.3; if (!cue.visible) return; }
    else cue.visible = c.on;
    const pull = S.state === 'aim' ? 0.035 + S.power * 0.3 : S.state === 'strike' ? (0.035 + S.shotPower * 0.3) * (1 - Math.min(1, S.strike) ** 2) : -0.01;
    const dx = Math.cos(S.angle), dz = Math.sin(S.angle), gap = R + 0.004 + pull;
    cue.position.set(c.x - dx * gap, BED + R + 0.006, c.z - dz * gap);
    cue.rotation.set(0, -S.angle, -0.1);
  };
  const buildGuide = () => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }); mat.name = 'snooker-guide';
    guide = new THREE.Group(); guide.name = 'snooker-guide';
    const mk = (geo) => { const o = new THREE.Mesh(geo, mat); o.raycast = () => {}; o.renderOrder = 4; guide.add(o); return o; };
    guide.userData.a = mk(BOX()); guide.userData.b = mk(BOX());
    guide.userData.ring = mk(cached('ghost', () => new THREE.RingGeometry(R * 0.82, R, 28).rotateX(-HALF)));
    guide.userData.mat = mat; dyn.add(guide);
  };
  const poseGuide = () => {
    if (!guide) buildGuide();
    guide.visible = S.state === 'aim' && G.balls[0].on && !S.chalking;
    if (!guide.visible) return;
    const c = G.balls[0], tr = aimTrace(G, S.angle), dx = Math.cos(S.angle), dz = Math.sin(S.angle), y = BED + 0.004, a = guide.userData.a, b = guide.userData.b, ring = guide.userData.ring;
    const len = Math.max(0.001, tr.t - R);
    a.position.set(c.x + dx * (R + len / 2), y, c.z + dz * (R + len / 2)); a.scale.set(len, 0.0015, 0.0045); a.rotation.set(0, -S.angle, 0);
    ring.position.set(tr.x, y, tr.z);
    if (tr.ball) {                                // where the object ball will go
      const ox = tr.ball.x - tr.x, oz = tr.ball.z - tr.z, ol = Math.hypot(ox, oz) || 1, L2 = 0.26;
      b.visible = true; b.position.set(tr.ball.x + ox / ol * (R + L2 / 2), y, tr.ball.z + oz / ol * (R + L2 / 2)); b.scale.set(L2, 0.0015, 0.0045); b.rotation.set(0, -Math.atan2(oz, ox), 0);
    } else b.visible = false;
  };
  // desired camera in the table frame: behind and above the cue ball; wider while the balls run
  const camWant = (pos, tgt) => {
    const c = S.state === 'roll' && S.shotFrom ? S.shotFrom : G.balls[0], dx = Math.cos(S.angle), dz = Math.sin(S.angle);
    const roll = S.state === 'roll', back = roll ? 1.22 : 1.02 + S.power * 0.1, hgt = roll ? 1.58 : 1.4, fwd = roll ? 0.35 : 0.72;
    pos.set(c.x - dx * back, hgt, c.z - dz * back);
    tgt.set(c.x + dx * fwd, BED, c.z + dz * fwd); if (roll) { tgt.x *= 0.45; tgt.z *= 0.45; }
  };
  const tween = (ms, fn) => new Promise(res => { const t0 = performance.now(); const stp = () => { if (disposed || !dyn.parent) return res(false); const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(stp); else res(true); }; stp(); });
  // chalk the tip: the cube hops to the cue tip, twists a few times in a puff of blue dust, hops back
  const chalkUp = async () => {
    if (S.chalking || (S.playing && S.state !== 'aim')) return; S.chalking = true; chalkPx.userData.open = true;
    if (S.playing) { const c = G.balls[0], dx = Math.cos(S.angle), dz = Math.sin(S.angle); cue.visible = true; cue.position.set(c.x - dx * 0.2, BED + R + 0.07, c.z - dz * 0.2); cue.rotation.set(0, -S.angle, -0.2); }
    else { cue.position.y = cueRest.p.y + 0.05; cue.rotation.z = cueRest.pitch - 0.05; }
    const tip = cueTip(new THREE.Vector3()), from = chalkRest.clone(), ax = new THREE.Vector3(1, 0, 0).applyEuler(cue.rotation);
    const qTip = new THREE.Quaternion().setFromUnitVectors(UP, ax.clone().negate()), q0 = chalk.quaternion.clone();
    if (!puff) { puff = new THREE.Mesh(cached('puff', () => new THREE.SphereGeometry(1, 10, 8)), new THREE.MeshBasicMaterial({ color: 0x6f9be0, transparent: true, opacity: 0, depthWrite: false })); puff.material.name = 'snooker-puff'; puff.raycast = () => {}; puff.visible = false; dyn.add(puff); }
    await tween(280, k => { const e = k * k * (3 - 2 * k); chalk.position.lerpVectors(from, tip, e); chalk.position.y += Math.sin(k * Math.PI) * 0.09; chalk.quaternion.slerpQuaternions(q0, qTip, e); });
    puff.visible = true; puff.position.copy(tip);
    await tween(620, k => { Q.setFromAxisAngle(ax, Math.sin(k * Math.PI * 5) * 0.9); chalk.quaternion.copy(Q).multiply(qTip); chalk.position.copy(tip).addScaledVector(ax, Math.sin(k * Math.PI * 10) * 0.0015);
      puff.scale.setScalar(0.012 + k * 0.05); puff.material.opacity = 0.42 * Math.sin(k * Math.PI); });
    puff.visible = false;
    await tween(280, k => { const e = k * k * (3 - 2 * k); chalk.position.lerpVectors(tip, from, e); chalk.position.y += Math.sin(k * Math.PI) * 0.09; chalk.quaternion.slerpQuaternions(qTip, q0, e); });
    chalk.position.copy(chalkRest); chalk.quaternion.copy(q0);
    if (!S.playing) restCue();
    S.chalking = false; chalkPx.userData.open = false;
  };

  // ---- enter / leave
  const canPlay = (w) => w && !w.disposed && !w.busy && !w.riding && !w.drive && !w._pano && w.camera && w.root && w.canvas;
  const enter = (w) => {
    if (S.playing || !canPlay(w)) return false;
    S.walker = w; S.playing = true; S.exiting = false; S.blend = 0; S.keys.clear(); S.charge = null; S.drag = null; S.hud = '';
    w.busy = true; w.glide = null; if (w.player && w.player.vel) w.player.vel.set(0, 0, 0); if (w.keys) w.keys.clear();
    if (!ui) buildUi(w); else { ui.style.display = ''; ui.dir = dirOf(w); }
    w.root.classList.add('vw-snk'); if (prompt) prompt.classList.remove('show');
    if (G.moving) { for (const b of G.balls) b.vx = b.vz = 0; G.moving = false; }
    S.state = 'aim'; S.angle = autoAim(G); setPower(0); hud();
    dyn.updateWorldMatrix(true, false); camWant(S.cp, S.ct);
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
    tablePx.userData.open = true;
    return true;
  };
  const finish = () => {
    const w = S.walker;
    S.playing = false; S.exiting = false; S.blend = 0; S.want = false; tablePx.userData.open = false;
    if (w) { w.busy = false; if (w.root) w.root.classList.remove('vw-snk'); }
    if (guide) guide.visible = false;
    if (!S.chalking) restCue();
  };
  const exit = (now = false) => {
    if (!S.playing || (S.exiting && !now)) return;
    S.exiting = true; S.charge = null; S.drag = null; S.keys.clear(); clearTimeout(S.rerackT);
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true);
    if (ui) ui.style.display = 'none';
    // nothing keeps rolling behind the visitor's back: finish the shot at once
    if (S.state === 'strike') S.state = 'aim';
    if (S.state === 'roll') { for (let i = 0; i < 900 && step(G, 0.05); i++); G.events.length = 0; for (const b of G.balls) b.drop = 0; afterShot(); if (G.done) rerack(); }
    for (const b of G.balls) b.drop = 0; sync();
    if (guide) guide.visible = false;
    if (now) finish();
  };
  const promptTick = (w) => {
    const now = performance.now(); if (now - S.promptT < 240) return; S.promptT = now;
    let near = false;
    const el = w.el || {}, covered = (el.help && el.help.classList.contains('show')) || (el.loading && !el.loading.classList.contains('hide')) || w._popOpen;   // help card / loading veil / settings popover
    if (w.mode === 'walk' && !covered && canPlay(w) && w.player) { dyn.getWorldPosition(v1); near = Math.abs(w.player.pos.y - v1.y) < 1.2 && Math.hypot(w.player.pos.x - v1.x, w.player.pos.z - v1.z) < HX + 1.75; }
    if (near && !prompt) {
      ensureCss(w.root); prompt = document.createElement('button'); prompt.className = 'snk-play'; prompt.type = 'button';
      prompt.addEventListener('click', (ev) => { ev.stopPropagation(); S.want = true; });
      w.root.appendChild(prompt);
    }
    if (prompt) { if (near) { S.walker = w; prompt.textContent = t('play'); } prompt.classList.toggle('show', near); }
  };

  tablePx.userData.toggle = () => { S.want = true; return Promise.resolve(); };
  chalkPx.userData.toggle = () => chalkUp();

  const C = {
    info: { size: K.size, ft: TABLES[K.size].ft, bed: [PL, PW], outer: [2 * HX, 2 * K.HZ] },
    game: G, state: S,
    get playing() { return S.playing && !S.exiting; },
    // called by walk.js once per frame, after the walker's own update and before render
    frame(w, dt) {
      if (disposed || !dyn.parent || !w) return;
      try {
        if (S.want && !S.playing) { S.want = false; enter(w); }
        if (!S.playing) return promptTick(w);
        if (w.disposed || w.drive || w.riding) return exit(true);
        dt = Math.min(0.1, Math.max(0, dt || 0));
        if (!S.exiting) {
          let turn = 0; if (S.keys.has('ArrowLeft') || S.keys.has('KeyA')) turn -= 1; if (S.keys.has('ArrowRight') || S.keys.has('KeyD')) turn += 1;
          if (turn && S.state === 'aim') S.angle += turn * dt * (S.keys.has('ShiftLeft') || S.keys.has('ShiftRight') ? 0.12 : 0.85);
          if (S.charge != null && S.state === 'aim') { const k = ((performance.now() - S.charge) / 1300) % 2; setPower(k < 1 ? k : 2 - k); }
          simulate(dt); poseCue(); poseGuide(); hud();
        }
        // camera: blend between the walker's own pose (just set by its update) and the play pose
        const cam = w.camera;
        wPos.copy(cam.position); wQuat.copy(cam.quaternion);
        dyn.updateWorldMatrix(true, false);
        camWant(v1, v2); const kk = 1 - Math.exp(-dt * (S.state === 'roll' ? 2.2 : 7)); S.cp.lerp(v1, kk); S.ct.lerp(v2, kk);
        v1.copy(S.cp).applyMatrix4(dyn.matrixWorld); v2.copy(S.ct).applyMatrix4(dyn.matrixWorld);
        pQuat.setFromRotationMatrix(M4.lookAt(v1, v2, UP));
        S.blend = Math.max(0, Math.min(1, S.blend + (S.exiting ? -1 : 1) * dt / 0.6));
        const e = S.blend * S.blend * (3 - 2 * S.blend);
        cam.position.lerpVectors(wPos, v1, e); cam.quaternion.slerpQuaternions(wQuat, pQuat, e);
        if (S.exiting && S.blend <= 0) finish();
      } catch (err) { if (!S.err) { S.err = true; console.warn('[snooker]', err); } if (S.playing) exit(true); }
    },
    // programmatic access (tests, dev pages)
    play(w) { return enter(w); }, exit, rerack, chalk: chalkUp, sync,
    aim(a) { S.angle = a; }, shot(a, p) { if (a != null) S.angle = a; setPower(p); fire(); },
    dispose() {
      disposed = true; clearTimeout(S.msgT); clearTimeout(S.rerackT);
      if (S.playing) { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); finish(); }
      if (ui) ui.remove(); if (prompt) prompt.remove(); ui = prompt = null;
      if (guide) guide.userData.mat.dispose(); if (puff) puff.material.dispose();
    },
  };
  return C;
}
