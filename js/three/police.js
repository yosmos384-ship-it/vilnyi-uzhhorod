// police.js — patrol police of the open-city driving mode (V8-people): wanted level 0–5, patrol cars in a generic
// Ukrainian patrol style (white / dark, blue-yellow reflective stripe, the word «ПОЛІЦІЯ», light bar — no emblem of any
// real body is reproduced), pursuit along the street graph (follow, box-in, PIT, roadblocks), loudspeaker order, officers
// who get out and arrest (a fine and a restart on foot — nobody shoots, no weapons exist in this module).
// createPolice(scene, { city, people, drive, lightMode, respawn, hud, lang, seed, audio }) — API at the end, recipe in notes/V8-people.md.
import * as THREE from 'three';
import { cityAdapter, driveAdapter, carState } from './people-adapters.js';
import { createPeopleAudio } from './people-audio.js';

const TAU = Math.PI * 2, hyp = Math.hypot, clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const rng = seed => { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

/** Heat an offence adds, and the heat each wanted level starts at. */
export const OFFENCES = { nudge: 0.5, hit: 1.5, hitHard: 3, kill: 2, body: 0.3, crash: 1, carjack: 2, witness: 1, speeding: 1, ram: 1.5, flee: 0.5, roadblock: 1 };
export const LEVEL_HEAT = [0, 1, 3, 6, 10, 15];
const UNITS_AT = [1, 1, 2, 3, 4, 5], TOP_SPEED = [16, 36, 44, 52, 60, 66];                    // m/s
export const POLICE_STRINGS = {
  uk: { order: 'Водію, негайно зупиніться! Притисніться праворуч!', orderPlate: 'Водій авто {p}, негайно зупиніться!', wanted: 'Розшук', arrested: 'Вас затримано', fine: 'Штраф', total: 'Разом', back: 'Ви повертаєтесь до комплексу пішки', lost: 'Поліція втратила вас з поля зору', seen: 'Вас помітив патруль',
    nudge: 'Наїзд на пішохода', hit: 'Наїзд на пішохода з травмами', hitHard: 'Тяжкий наїзд на пішохода', kill: 'ДТП із загиблим', body: 'Наїзд на потерпілого', crash: 'Зіткнення з автомобілем', carjack: 'Незаконне заволодіння автомобілем', witness: 'Виклик поліції свідком', speeding: 'Перевищення швидкості', ram: 'Таран патрульного авто', flee: 'Невиконання вимоги про зупинку', roadblock: 'Прорив блокпоста' },
  en: { order: 'Driver, stop the car now! Pull over to the right!', orderPlate: 'Driver of {p}, stop the car now!', wanted: 'Wanted', arrested: 'You are detained', fine: 'Fine', total: 'Total', back: 'You return to the complex on foot', lost: 'The police lost sight of you', seen: 'A patrol has spotted you',
    nudge: 'Hitting a pedestrian', hit: 'Injuring a pedestrian', hitHard: 'Seriously injuring a pedestrian', kill: 'Fatal road accident', body: 'Driving over a casualty', crash: 'Collision with a vehicle', carjack: 'Taking a vehicle unlawfully', witness: 'Reported by a witness', speeding: 'Speeding', ram: 'Ramming a patrol car', flee: 'Failing to stop for the police', roadblock: 'Breaking through a roadblock' },
  he: { order: 'נהג, עצור מיד! היצמד לימין!', orderPlate: 'נהג הרכב {p}, עצור מיד!', wanted: 'מבוקש', arrested: 'נעצרת', fine: 'קנס', total: 'סה"כ', back: 'חוזרים למתחם ברגל', lost: 'המשטרה איבדה אותך', seen: 'ניידת זיהתה אותך',
    nudge: 'פגיעה בהולך רגל', hit: 'פציעת הולך רגל', hitHard: 'פציעה קשה של הולך רגל', kill: 'תאונה קטלנית', body: 'דריסת נפגע', crash: 'התנגשות ברכב', carjack: 'נטילת רכב שלא כדין', witness: 'דיווח של עד', speeding: 'מהירות מופרזת', ram: 'נגיחה בניידת', flee: 'אי־ציות להוראת עצירה', roadblock: 'פריצת מחסום' },
  ro: { order: 'Șofer, opriți imediat! Trageți pe dreapta!', orderPlate: 'Șoferul mașinii {p}, opriți imediat!', wanted: 'Urmărit', arrested: 'Sunteți reținut', fine: 'Amendă', total: 'Total', back: 'Vă întoarceți pe jos la complex', lost: 'Poliția v-a pierdut din vedere', seen: 'O patrulă v-a observat',
    nudge: 'Lovirea unui pieton', hit: 'Rănirea unui pieton', hitHard: 'Rănirea gravă a unui pieton', kill: 'Accident mortal', body: 'Trecere peste o victimă', crash: 'Coliziune cu un vehicul', carjack: 'Luarea ilegală a unui vehicul', witness: 'Sesizare de la un martor', speeding: 'Depășirea vitezei', ram: 'Lovirea mașinii de patrulare', flee: 'Neoprire la semnalul poliției', roadblock: 'Forțarea unui baraj' },
  de: { order: 'Fahrer, sofort anhalten! Rechts ranfahren!', orderPlate: 'Fahrer des Wagens {p}, sofort anhalten!', wanted: 'Gesucht', arrested: 'Sie sind festgenommen', fine: 'Bußgeld', total: 'Gesamt', back: 'Sie kehren zu Fuß zum Komplex zurück', lost: 'Die Polizei hat Sie aus den Augen verloren', seen: 'Eine Streife hat Sie bemerkt',
    nudge: 'Fußgänger angefahren', hit: 'Fußgänger verletzt', hitHard: 'Fußgänger schwer verletzt', kill: 'Unfall mit Todesfolge', body: 'Überfahren eines Verletzten', crash: 'Zusammenstoß mit einem Fahrzeug', carjack: 'Unbefugte Inbesitznahme eines Fahrzeugs', witness: 'Anzeige eines Zeugen', speeding: 'Geschwindigkeitsüberschreitung', ram: 'Rammen eines Streifenwagens', flee: 'Missachtung des Haltesignals', roadblock: 'Durchbrechen einer Straßensperre' },
  fr: { order: 'Conducteur, arrêtez-vous immédiatement ! Serrez à droite !', orderPlate: 'Conducteur du véhicule {p}, arrêtez-vous !', wanted: 'Recherché', arrested: 'Vous êtes interpellé', fine: 'Amende', total: 'Total', back: 'Vous revenez à pied au complexe', lost: 'La police vous a perdu de vue', seen: 'Une patrouille vous a repéré',
    nudge: 'Piéton heurté', hit: 'Piéton blessé', hitHard: 'Piéton grièvement blessé', kill: 'Accident mortel', body: 'Passage sur une victime', crash: 'Collision avec un véhicule', carjack: 'Prise illégale d\'un véhicule', witness: 'Signalement d\'un témoin', speeding: 'Excès de vitesse', ram: 'Percussion d\'une voiture de patrouille', flee: 'Refus d\'obtempérer', roadblock: 'Forçage d\'un barrage' },
  it: { order: 'Conducente, si fermi subito! Accosti a destra!', orderPlate: 'Conducente dell\'auto {p}, si fermi subito!', wanted: 'Ricercato', arrested: 'Lei è in stato di fermo', fine: 'Multa', total: 'Totale', back: 'Torna al complesso a piedi', lost: 'La polizia l\'ha persa di vista', seen: 'Una pattuglia l\'ha notata',
    nudge: 'Urto a un pedone', hit: 'Ferimento di un pedone', hitHard: 'Grave ferimento di un pedone', kill: 'Incidente mortale', body: 'Passaggio su un ferito', crash: 'Collisione con un veicolo', carjack: 'Impossessamento illecito di un veicolo', witness: 'Segnalazione di un testimone', speeding: 'Eccesso di velocità', ram: 'Speronamento di un\'auto di pattuglia', flee: 'Mancato arresto all\'alt', roadblock: 'Forzatura di un posto di blocco' },
};
/** Fictional fines of the game, in hryvnias. */
export const FINES = { nudge: 1700, hit: 8500, hitHard: 17000, kill: 51000, body: 3400, crash: 3400, carjack: 34000, witness: 0, speeding: 1700, ram: 17000, flee: 5100, roadblock: 8500 };

// ---- the patrol car model (generic, built here: no model files, nobody else's module needed) ---------------------------------------
const CAR = { L: 4.55, W: 1.82, H: 1.5, wb: 2.7 };
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const side = document.createElement('canvas'); side.width = 1024; side.height = 256; let g = side.getContext('2d');
  g.clearRect(0, 0, 1024, 256);
  // the reflective band: blue with a yellow-green checker edge, the word in the middle
  g.fillStyle = '#12489c'; g.fillRect(0, 96, 1024, 74); g.fillStyle = '#d7e21f'; for (let i = 0; i < 32; i++) { g.fillRect(i * 32, i % 2 ? 84 : 170, 32, 12); } g.fillStyle = '#f4f4f0'; g.fillRect(0, 126, 1024, 4);
  g.fillStyle = '#12489c'; g.fillRect(360, 20, 330, 62); g.fillStyle = '#ffffff'; g.font = 'bold 54px Arial, "DejaVu Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ПОЛІЦІЯ', 525, 53);
  g.fillStyle = '#12489c'; g.font = 'bold 44px Arial, "DejaVu Sans", sans-serif'; g.fillText('102', 880, 46);
  const sideTex = new THREE.CanvasTexture(side); sideTex.colorSpace = THREE.SRGBColorSpace; sideTex.anisotropy = 4;
  const top = document.createElement('canvas'); top.width = 512; top.height = 128; g = top.getContext('2d'); g.clearRect(0, 0, 512, 128); g.fillStyle = '#ffffff'; g.font = 'bold 84px Arial, "DejaVu Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ПОЛІЦІЯ', 256, 68);
  const topTex = new THREE.CanvasTexture(top); topTex.colorSpace = THREE.SRGBColorSpace;
  const M = n => new THREE.MeshStandardMaterial(n);
  // body profile (z forward, y up), extruded across the width with rounded shoulders
  const prof = (pts, w, bevel) => { const s = new THREE.Shape(); pts.forEach(([z, y], i) => i ? s.lineTo(z, y) : s.moveTo(z, y)); s.closePath(); const geo = new THREE.ExtrudeGeometry(s, { depth: w - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 4 }); geo.translate(0, 0, -(w - 2 * bevel) / 2); geo.rotateY(-Math.PI / 2); return geo; };
  const hl = CAR.L / 2;
  const lower = prof([[-hl + 0.06, 0.34], [-hl, 0.62], [-hl + 0.08, 0.92], [-hl + 0.55, 0.99], [0.62, 0.98], [hl - 0.75, 0.86], [hl - 0.08, 0.74], [hl, 0.52], [hl - 0.05, 0.3], [hl - 0.5, 0.22], [-hl + 0.5, 0.22]], CAR.W, 0.09);
  const bonnet = prof([[0.66, 0.985], [hl - 0.75, 0.87], [hl - 0.1, 0.75], [hl - 0.1, 0.7], [0.66, 0.9]], CAR.W - 0.06, 0.05);
  const cabin = prof([[-hl + 0.42, 0.97], [-hl + 0.98, 1.43], [-0.05, 1.5], [0.42, 1.46], [1.12, 0.97]], CAR.W - 0.24, 0.1);
  const roof = prof([[-hl + 0.95, 1.45], [-0.05, 1.525], [0.44, 1.485], [0.44, 1.44], [-0.05, 1.47], [-hl + 0.97, 1.4]], CAR.W - 0.16, 0.04);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16); wheel.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 10); hub.rotateZ(Math.PI / 2);
  SHARED = { sideTex, topTex, lower, bonnet, cabin, roof, wheel, hub,
    white: M({ color: 0xf1f2f0, roughness: 0.35, metalness: 0.1 }), dark: M({ color: 0x16181c, roughness: 0.4, metalness: 0.2 }), glass: M({ color: 0x0b0f14, roughness: 0.08, metalness: 0.6 }),
    tyre: M({ color: 0x0c0c0d, roughness: 0.9 }), rim: M({ color: 0x8c9096, roughness: 0.4, metalness: 0.7 }), bar: M({ color: 0x1b1d21, roughness: 0.5 }),
    livery: new THREE.MeshStandardMaterial({ map: sideTex, transparent: true, roughness: 0.3, emissive: 0xffffff, emissiveMap: sideTex, emissiveIntensity: 0.12, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    word: new THREE.MeshStandardMaterial({ map: topTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff6dc }), tail: new THREE.MeshBasicMaterial({ color: 0xb01010 }) };
  return SHARED;
}
/** A patrol car: → { group, L, W, setLights(on, t, night, withLight), setDoors(k), dispose() } — origin on the ground under the centre, facing +z.
 *  base (optional): a white car of the driving code { group, L, W, H, setDoor?(k) } that gets the livery and the light bar;
 *  without it the simple body built here is used. */
export function createPatrolCar({ base = null } = {}) {
  const S = shared(), g = new THREE.Group(); g.name = 'vrc-police-car'; const own = [];
  const add = (geo, mat, x = 0, y = 0, z = 0, par = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
  const D = base ? { L: base.L || 4.8, W: base.W || 1.9, H: base.H || 1.45 } : CAR, hl = D.L / 2, hw = D.W / 2, barZ = base ? -0.25 : -0.2, barY = D.H + (base ? 0.0 : 0.03);
  let doors = [];
  if (base) g.add(base.group);
  else {
    add(S.lower, S.white); add(S.bonnet, S.dark); add(S.cabin, S.glass); add(S.roof, S.white);
    const arch = new THREE.CylinderGeometry(0.41, 0.41, 0.05, 18, 1, false, 0, Math.PI); arch.rotateZ(Math.PI / 2); arch.rotateX(Math.PI / 2); own.push(arch);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { add(S.wheel, S.tyre, sx * (hw - 0.1), 0.33, sz * CAR.wb / 2 + 0.05); add(S.hub, S.rim, sx * (hw - 0.095), 0.33, sz * CAR.wb / 2 + 0.05); const a = add(arch, S.dark, sx * (hw + 0.002), 0.33, sz * CAR.wb / 2 + 0.05); a.rotation.x = Math.PI; }
    const wd = new THREE.PlaneGeometry(1.25, 0.31), w1 = add(wd, S.word, 0, 0.9, hl - 0.86); w1.rotation.set(-Math.PI / 2 + 0.12, 0, Math.PI); const w2 = add(wd, S.word, 0, 0.78, -hl - 0.012); w2.rotation.y = Math.PI; w2.scale.setScalar(0.62); own.push(wd);
    const lamp = new THREE.BoxGeometry(0.36, 0.1, 0.05); own.push(lamp); for (const sx of [-1, 1]) { add(lamp, S.head, sx * 0.62, 0.72, hl - 0.03); add(lamp, S.tail, sx * 0.62, 0.84, -hl + 0.03); }
    doors = [-1, 1].map(sx => { const piv = new THREE.Group(); piv.position.set(sx * (hw + 0.012), 0.34, 0.72); const dg = new THREE.BoxGeometry(0.04, 0.6, 1.02); own.push(dg); const d = new THREE.Mesh(dg, S.white); d.position.set(0, 0.32, -0.51); piv.add(d); piv.visible = false; g.add(piv); return { piv, sx }; });
  }
  // livery: the band on both sides (between the wheel arches when the body is somebody else's model)
  const band = new THREE.PlaneGeometry(base ? D.L * 0.46 : D.L - 0.5, base ? 0.4 : 0.62); own.push(band);
  if (base) { const uv = band.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 0.24 + uv.getX(i) * 0.52); }
  for (const sx of [-1, 1]) { const m = add(band, S.livery, sx * (hw + (base ? 0.012 : 0.004)), base ? 0.68 : 0.66, base ? -0.05 : 0); m.rotation.y = sx * Math.PI / 2; }
  // light bar: a dark base with a blue and a red lens (flashing alternately)
  const barG = new THREE.BoxGeometry(1.12, 0.05, 0.28), lens = new THREE.BoxGeometry(0.5, 0.11, 0.24), blue = new THREE.MeshBasicMaterial({ color: 0x0b1d55 }), red = new THREE.MeshBasicMaterial({ color: 0x4a0808 }); own.push(barG, lens);
  add(barG, S.bar, 0, barY, barZ); add(lens, blue, 0.29, barY + 0.07, barZ); add(lens, red, -0.29, barY + 0.07, barZ);
  // glow sprites (cheap, visible from far at night) + one point light switched on only for the nearest units
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const q = c.getContext('2d'), gr = q.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = gr; q.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const sp = col => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(1.5); s.visible = false; g.add(s); return s; };
  const gB = sp(0x2f6bff), gR = sp(0xff2a22); gB.position.set(0.29, barY + 0.13, barZ); gR.position.set(-0.29, barY + 0.13, barZ);
  const pl = new THREE.PointLight(0x3060ff, 0, 26, 1.8); pl.position.set(0, barY + 0.5, barZ); g.add(pl);
  return { group: g, pl, L: D.L, W: D.W,
    setLights(on, t, night = false, withLight = false) { const ph = on ? Math.floor(t * 5.5) % 2 : -1, f = on ? (t * 5.5) % 1 < 0.72 : false; blue.color.setHex(ph === 0 && f ? 0x4d86ff : 0x0b1d55); red.color.setHex(ph === 1 && f ? 0xff3a30 : 0x4a0808); gB.visible = ph === 0 && f; gR.visible = ph === 1 && f; const sc = night ? 3.4 : 1.4; gB.scale.setScalar(sc); gR.scale.setScalar(sc); pl.intensity = on && withLight && f ? (night ? 90 : 25) : 0; pl.color.setHex(ph === 0 ? 0x3060ff : 0xff3020); },
    setDoors(k) { if (base) { if (base.setDoor) base.setDoor(k); return; } for (const d of doors) { d.piv.visible = k > 0.02; d.piv.rotation.y = -d.sx * k * 1.15; } },
    dispose() { glowTex.dispose(); gB.material.dispose(); gR.material.dispose(); blue.dispose(); red.dispose(); for (const o of own) o.dispose(); if (base && base.dispose) base.dispose(); g.parent?.remove(g); } };
}

// ---- A* on the drivable road graph ---------------------------------------------------------------------------------------------------
function makeRouter(R) {
  const N = R.nodes.length, gS = new Float32Array(N), from = new Int32Array(N), stamp = new Int32Array(N); let run = 0;
  return function route(a, b, max = 4000) {
    if (a < 0 || b < 0) return null; if (a === b) return [a]; run++; const open = [a], B = R.nodes[b]; gS[a] = 0; from[a] = -1; stamp[a] = run; let it = 0; const closed = new Set();
    while (open.length && it++ < max) {
      let bi = 0, bf = Infinity; for (let i = 0; i < open.length; i++) { const n = R.nodes[open[i]], f = gS[open[i]] + hyp(n.x - B.x, n.z - B.z); if (f < bf) { bf = f; bi = i; } }
      const cur = open.splice(bi, 1)[0]; if (cur === b) { const out = []; for (let n = b; n >= 0; n = from[n]) out.push(n); return out.reverse(); } closed.add(cur);
      for (const ei of R.nodes[cur].edges) { const e = R.edges[ei], nb = e.a === cur ? e.b : e.a; if (closed.has(nb)) continue; const g2 = gS[cur] + e.len; if (stamp[nb] !== run || g2 < gS[nb]) { if (stamp[nb] !== run) open.push(nb); stamp[nb] = run; gS[nb] = g2; from[nb] = cur; } }
    }
    return null;
  };
}

export function createPolice(scene, opts = {}) {
  let city = cityAdapter(opts.city, opts.cityOptions); const people = opts.people || null, drive = driveAdapter(opts.drive || (people && people.drive) || null);
  const audio = opts.audio || (people && people.audio) || createPeopleAudio(), ownAudio = !opts.audio && !(people && people.audio);
  const rnd = rng((opts.seed ?? 4102) >>> 0), lang = opts.lang || 'uk', TX = k => (POLICE_STRINGS[api?.lang || lang] || POLICE_STRINGS.uk)[k] ?? POLICE_STRINGS.uk[k] ?? k;
  const L = {}, emit = (evt, d) => { (L[evt] || []).forEach(cb => { try { cb(d); } catch (e) { console.error(e); } }); };
  const root = new THREE.Group(); root.name = 'vrc-police'; scene.add(root);
  const units = [], record = new Map(), log = [];
  let heat = 0, wanted = 0, time = 0, unseen = 0, seen = false, lastSeen = null, chaseT = 0, orderT = 0, stopT = 0, arrest = null, disposed = false, nextId = 1, light = 'day', slowT = 0, enabled = opts.enabled !== false, fleeT = 0, ambient = opts.ambient !== false, spawnT = 0, blockT = 0;
  const router = city && city.roads ? makeRouter(city.roads) : null;
  const P = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0, onFoot: false, ref: null, L: 4.8, W: 1.9, has: false }, cam = { x: 0, z: 0 };
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();

  // ---- wanted level ---------------------------------------------------------------------------------------------------------------------
  function setLevel(n, reason) {
    n = clamp(Math.round(n), 0, 5); if (n === wanted) return; const was = wanted; wanted = n; log.push({ t: +time.toFixed(1), level: n, was, reason });
    if (n > was) { unseen = 0; } if (n === 0) { heat = 0; chaseT = 0; record.clear(); for (const u of units) if (u.mode !== 'patrol' && !u.block) { u.mode = 'patrol'; u.path = null; stopSiren(u); } clearBlocks(); emit('police:clear', {}); }
    emit('police:wanted', { level: n, was, reason }); renderHud();
  }
  /** An offence happened. code: a key of OFFENCES; o.pos where; o.heat overrides the amount. */
  function report(code, o = {}) {
    if (!enabled || arrest) return wanted; const h = o.heat ?? OFFENCES[code]; if (h == null) return wanted;
    record.set(code, (record.get(code) || 0) + 1); heat = Math.min(LEVEL_HEAT[5] + 2, heat + h); if (o.pos) lastSeen = lastSeen || { x: o.pos.x, z: o.pos.z };
    let lv = 0; for (let i = 5; i > 0; i--) if (heat >= LEVEL_HEAT[i]) { lv = i; break; }
    if (lv > wanted) setLevel(lv, code); return wanted;
  }
  // ---- geometry helpers -----------------------------------------------------------------------------------------------------------------
  const blockedLine = (ax, az, bx, bz) => { if (!city || !city.blocked) return false; const d = hyp(bx - ax, bz - az), n = Math.max(2, Math.ceil(d / 4)); for (let i = 1; i < n; i++) { const t = i / n; if (city.blocked(lerp(ax, bx, t), lerp(az, bz, t))) return true; } return false; };
  const inView = (x, z) => { sph.center.set(x, 1, z); sph.radius = 3; return frustum.intersectsSphere(sph); };
  const hidden = (x, z) => { const d = hyp(x - cam.x, z - cam.z); return d > 260 || (d > 60 && !inView(x, z)) || (d > 45 && blockedLine(cam.x, cam.z, x, z)); };
  const nodeOf = (x, z) => city ? city.nearestRoadNode(x, z) : -1;

  // ---- units ----------------------------------------------------------------------------------------------------------------------------
  function spawnUnit(mode = 'respond', at = null) {
    if (!city || !city.roads) return null; const R = city.roads; let best = -1, bs = -1e9;
    if (at == null) { for (let k = 0; k < 60; k++) { const i = Math.floor(rnd() * R.nodes.length), n = R.nodes[i]; if (!n.edges.length) continue; const d = hyp(n.x - P.x, n.z - P.z); if (d < (mode === 'patrol' ? 90 : 60) || d > (mode === 'patrol' ? 320 : 230) || !hidden(n.x, n.z)) continue; if (units.some(u => hyp(u.x - n.x, u.z - n.z) < 25)) continue;
      const ahead = ((n.x - P.x) * P.vx + (n.z - P.z) * P.vz) / (d * (P.speed || 1) + 1e-6), s = -Math.abs(d - (mode === 'patrol' ? 170 : 110)) / 100 + (mode === 'patrol' ? 0 : ahead * 0.6) + rnd() * 0.3; if (s > bs) { bs = s; best = i; } } }
    else best = at;
    if (best < 0) return null; const n = R.nodes[best], e = R.edges[n.edges[0]], o = R.nodes[e.a === best ? e.b : e.a];
    const car = createPatrolCar({ base: typeof opts.carFactory === 'function' ? opts.carFactory() : null }), u = { id: nextId++, car, x: n.x, z: n.z, yaw: Math.atan2(o.x - n.x, o.z - n.z), v: 0, mode, node: best, path: null, pi: 0, planT: 0, slot: units.length % 4, siren: null, officers: [], doorK: 0, stuck: 0, hitT: -9, block: null, orderT: 0, born: time, L: car.L, W: car.W, kind: 'police' };
    car.group.position.set(u.x, 0, u.z); car.group.rotation.y = u.yaw; root.add(car.group); units.push(u); emit('police:spawn', { unit: u, mode }); return u;
  }
  function removeUnit(u) { stopSiren(u); for (const a of u.officers) a.remove(); u.officers.length = 0; u.car.dispose(); const i = units.indexOf(u); if (i >= 0) units.splice(i, 1); }
  function stopSiren(u) { if (u.siren) { u.siren.stop(); u.siren = null; } }
  function plan(u, tx, tz) { if (!router) return; const a = nodeOf(u.x, u.z), b = nodeOf(tx, tz), r = router(a, b); u.planT = time + 1.2 + rnd() * 0.6; if (!r) { u.path = null; return; } const R = city.roads; u.path = r.map(i => R.nodes[i]); u.pi = 0; if (u.path.length > 1) { const n0 = u.path[0], n1 = u.path[1], ex = n1.x - n0.x, ez = n1.z - n0.z, l2 = ex * ex + ez * ez || 1, t = ((u.x - n0.x) * ex + (u.z - n0.z) * ez) / l2, off = Math.abs((u.x - n0.x) * ez - (u.z - n0.z) * ex) / Math.sqrt(l2); if (hyp(n0.x - u.x, n0.z - u.z) < 6 || (t > 0 && off < 9)) u.pi = 1; } u.pathNodes = r; }
  /** Kinematic car: steer to (tx, tz) at up to `vmax`; lateral grip and braking limits keep it plausible. */
  function driveTo(u, tx, tz, vmax, dt, { arrive = false } = {}) {
    const dx = tx - u.x, dz = tz - u.z, d = hyp(dx, dz), want = Math.atan2(dx, dz), da = angDiff(want, u.yaw);
    let vt = vmax * clamp(1.15 - Math.abs(da) * 0.9, 0.22, 1); if (arrive) vt = Math.min(vt, Math.sqrt(2 * 7 * Math.max(0, d - 1.5)));
    // do not run people over: brake for anybody in the corridor ahead
    if (people && u.v > 1) { const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw); for (const c of people.colliders(u.x, u.z, 6 + u.v * 1.2)) { const ax = c.x - u.x, az = c.z - u.z, ah = ax * fx + az * fz, sd = Math.abs(ax * -fz + az * fx); if (ah > 0 && ah < 4 + u.v * 1.1 && sd < 1.5) { vt = Math.min(vt, Math.max(0, (ah - 3.5) * 1.2)); } } }
    for (const o of units) { if (o === u) continue; const ax = o.x - u.x, az = o.z - u.z, ah = ax * Math.sin(u.yaw) + az * Math.cos(u.yaw), sd = Math.abs(ax * -Math.cos(u.yaw) + az * Math.sin(u.yaw)); if (ah > 0 && ah < 5 + u.v * 0.6 && sd < 2.0) vt = Math.min(vt, Math.max(0, o.v * 0.9 + (ah - 5.5))); }
    u.v += clamp(vt - u.v, -12 * dt, (u.v < 22 ? 8 : 4.5) * dt); if (u.v < 0) u.v = 0;
    const maxYaw = Math.min(2.6, 10.5 / Math.max(u.v, 2.5)) * (u.v < 0.4 ? u.v / 0.4 : 1); u.yaw += clamp(da, -maxYaw * dt, maxYaw * dt);
    const nx = u.x + Math.sin(u.yaw) * u.v * dt, nz = u.z + Math.cos(u.yaw) * u.v * dt;
    if (city && city.blocked && city.blocked(nx + Math.sin(u.yaw) * 2.2, nz + Math.cos(u.yaw) * 2.2)) { u.v = Math.max(0, u.v - 30 * dt); u.yaw += (da >= 0 ? 1 : -1) * 1.6 * dt; u.stuck += dt; u.direct = time + 3; if (city.blocked(nx, nz)) return d; } else u.stuck = Math.max(0, u.stuck - dt * 0.5);
    u.x = nx; u.z = nz; return d;
  }
  function followPath(u, vmax, dt, final = null) {
    if (!u.path || u.pi >= u.path.length) { if (final) return driveTo(u, final[0], final[1], vmax, dt); u.v = Math.max(0, u.v - 8 * dt); return 0; }
    const n = u.path[u.pi], last = u.pi === u.path.length - 1; let vm = vmax;
    // slow for the corner at the next node
    if (!last || final) { const m = last ? { x: final[0], z: final[1] } : u.path[u.pi + 1], a1 = Math.atan2(n.x - u.x, n.z - u.z), a2 = Math.atan2(m.x - n.x, m.z - n.z), turn = Math.abs(angDiff(a2, a1)), dn = hyp(n.x - u.x, n.z - u.z), vc = lerp(vmax, 9.5, clamp(turn / 1.2)); vm = Math.min(vmax, Math.sqrt(vc * vc + 2 * 9 * dn)); }
    const d = driveTo(u, n.x, n.z, vm, dt); if (d < Math.max(5, u.v * 0.45)) u.pi++; return d;
  }
  // roadblocks: two cars across the road some way ahead of where the player is heading
  const blocks = [];
  function clearBlocks() { for (const b of blocks.splice(0)) for (const u of b.units) { if (hidden(u.x, u.z) || true) removeUnit(u); } }
  function placeRoadblock() {
    if (!city || !city.roads || !P.has || P.speed < 6) return false; const R = city.roads; let node = nodeOf(P.x + P.vx * 2, P.z + P.vz * 2), heading = Math.atan2(P.vx, P.vz), dist = 0, prev = -1, edge = null;
    for (let k = 0; k < 14 && dist < 150; k++) { const n = R.nodes[node]; let be = -1, bd = 1.1; for (const ei of n.edges) { const e = R.edges[ei], o = R.nodes[e.a === node ? e.b : e.a]; if ((e.a === node ? e.b : e.a) === prev) continue; const da = Math.abs(angDiff(Math.atan2(o.x - n.x, o.z - n.z), heading)); if (da < bd) { bd = da; be = ei; } } if (be < 0) break; const e = R.edges[be], nx = e.a === node ? e.b : e.a; heading = Math.atan2(R.nodes[nx].x - n.x, R.nodes[nx].z - n.z); dist += e.len; prev = node; node = nx; edge = e; }
    if (!edge || dist < 90) return false; const A = R.nodes[prev], Z = R.nodes[node], mx = lerp(A.x, Z.x, 0.5), mz = lerp(A.z, Z.z, 0.5), yaw = Math.atan2(Z.x - A.x, Z.z - A.z); if (!hidden(mx, mz) || hyp(mx - P.x, mz - P.z) < 80) return false;
    const b = { x: mx, z: mz, yaw, units: [], born: time, passed: false }, w = edge.w || 8, px = Math.cos(yaw), pz = -Math.sin(yaw);
    for (const s of [-1, 1]) { const u = spawnUnit('block', prev); if (!u) continue; u.x = mx + px * s * (w / 4 - 0.1) + Math.sin(yaw) * s * 0.9; u.z = mz + pz * s * (w / 4 - 0.1) + Math.cos(yaw) * s * 0.9; u.yaw = yaw + Math.PI / 2 + s * 0.22; u.block = b; u.v = 0; b.units.push(u);
      if (people) { const a = people.makeActor({ role: 'police', x: u.x - Math.sin(yaw) * 3.2 + px * s * 1.5, z: u.z - Math.cos(yaw) * 3.2 + pz * s * 1.5, yaw: yaw + Math.PI }); a.pose('wave'); u.officers.push(a); } }
    blocks.push(b); emit('police:roadblock', { x: mx, z: mz, yaw }); return true;
  }

  // ---- contact between a patrol car and the player's car ---------------------------------------------------------------------------------
  function contact(u, dt) {
    if (!P.has || P.onFoot) return; const dx = P.x - u.x, dz = P.z - u.z, d = hyp(dx, dz); if (d > 5.2) return;
    // two-circle test per car (front / rear)
    let hit = null; for (const a of [-1.25, 1.25]) for (const b of [-1.25, 1.25]) { const ax = u.x + Math.sin(u.yaw) * a, az = u.z + Math.cos(u.yaw) * a, bx = P.x + Math.sin(P.yaw) * b, bz = P.z + Math.cos(P.yaw) * b, dd = hyp(bx - ax, bz - az); if (dd < 1.9 && (!hit || dd < hit.d)) hit = { d: dd, nx: (bx - ax) / (dd || 1), nz: (bz - az) / (dd || 1), b }; }
    if (!hit) return; const pen = 1.9 - hit.d, rvx = P.vx - Math.sin(u.yaw) * u.v, rvz = P.vz - Math.cos(u.yaw) * u.v, closing = -(rvx * hit.nx + rvz * hit.nz);
    const still = u.mode === 'block' || u.mode === 'stop' || u.v < 0.5;
    if (!u.block) { u.x -= hit.nx * pen * 0.8; u.z -= hit.nz * pen * 0.8; } u.contactT = time;
    if (closing > 0.8 && time - u.hitT > 0.5) { u.hitT = time; const j = closing * (still ? 0.9 : 0.55); drive.impulse(P.ref, hit.nx * j, hit.nz * j); if (!still) u.v = Math.max(0, u.v - closing * 0.5); audio.thud(u.x, u.z, clamp(closing / 14, 0.3, 1));
      emit('police:contact', { unit: u, speed: closing, pit: u.mode === 'pit', normal: [hit.nx, hit.nz], pos: { x: (u.x + P.x) / 2, z: (u.z + P.z) / 2 } });
      if (P.speed > 6 && closing > 5 && (still || Math.abs(angDiff(P.yaw, Math.atan2(-dx, -dz))) < 0.9)) { report(u.block ? 'roadblock' : 'ram', { pos: P }); if (u.block) u.block.passed = true; } }
  }

  // ---- officers: stop, walk to the driver's door, arrest ---------------------------------------------------------------------------------
  function officersOut(u) {
    if (u.officers.length || !people) return; const px = Math.cos(u.yaw), pz = -Math.sin(u.yaw);
    for (const s of [1, -1]) { const a = people.makeActor({ role: 'police', x: u.x + px * s * 1.45 + Math.sin(u.yaw) * 0.5, z: u.z + pz * s * 1.45 + Math.cos(u.yaw) * 0.5, yaw: u.yaw }); a.side = s; u.officers.push(a); }
    u.doorT = 1; emit('police:stop', { unit: u });
  }
  function officersIn(u) { for (const a of u.officers) a.remove(); u.officers.length = 0; u.doorT = 0; }
  function doArrest(u) {
    const offences = [...record.entries()].map(([code, n]) => ({ code, n, text: TX(code), fine: FINES[code] * n })), fine = offences.reduce((s, o) => s + o.fine, 0);
    const respawn = opts.respawn || { x: 0, z: 0 }; arrest = { t: 0, offences, fine, respawn, unit: u, done: false };
    log.push({ t: +time.toFixed(1), arrest: offences.map(o => o.code + '×' + o.n).join(', '), fine }); audio.stopSirens?.(); for (const q of units) q.siren = null;
    emit('police:arrest', { offences, fine, respawn, level: wanted }); showArrest();
  }
  function finishArrest() { const a = arrest; arrest = null; for (const u of [...units]) removeUnit(u); blocks.length = 0; setLevel(0, 'arrest'); heat = 0; record.clear(); hideArrest(); emit('police:respawn', { ...a.respawn, fine: a.fine }); if (typeof opts.onRespawn === 'function') opts.onRespawn(a.respawn); }

  // ---- HUD (stars, loudspeaker line, arrest sheet) — plain DOM, removable with hud: false ---------------------------------------------------------
  let hud = null, starEl = null, orderEl = null, sheet = null, orderHide = 0;
  if (opts.hud !== false && typeof document !== 'undefined') {
    const host = opts.hud instanceof Element ? opts.hud : document.body; hud = document.createElement('div'); hud.className = 'vrc-police-hud'; hud.setAttribute('aria-live', 'polite');
    hud.innerHTML = '<style>.vrc-police-hud{position:fixed;inset:0;pointer-events:none;z-index:60;font:600 15px/1.35 system-ui,"Segoe UI",Arial,sans-serif;color:#fff}.vrc-police-stars{position:absolute;top:14px;right:16px;display:flex;gap:4px;align-items:center;padding:6px 10px;border-radius:10px;background:rgba(10,14,22,.55);opacity:0;transition:opacity .4s}.vrc-police-stars.on{opacity:1}.vrc-police-stars span{font-size:22px;line-height:1;color:rgba(255,255,255,.22);transition:color .25s,transform .25s}.vrc-police-stars span.on{color:#ffd23a;text-shadow:0 0 8px rgba(255,180,0,.8)}.vrc-police-stars.lost span.on{animation:vrcpb 1s steps(2) infinite}@keyframes vrcpb{50%{color:rgba(255,210,58,.35)}}.vrc-police-stars b{font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-inline-end:6px;opacity:.8}.vrc-police-order{position:absolute;left:50%;bottom:18%;transform:translateX(-50%);max-width:86vw;padding:9px 16px;border-radius:8px;background:rgba(12,40,110,.88);border:1px solid rgba(215,226,31,.8);text-align:center;opacity:0;transition:opacity .3s}.vrc-police-order.on{opacity:1}.vrc-police-sheet{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0);opacity:0;transition:opacity 1s,background 1.2s}.vrc-police-sheet.on{opacity:1;background:rgba(0,0,0,.94)}.vrc-police-sheet div{max-width:min(520px,88vw)}.vrc-police-sheet h2{margin:0 0 14px;font-size:26px;color:#ffd23a}.vrc-police-sheet table{width:100%;border-collapse:collapse;font-weight:400}.vrc-police-sheet td{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.14)}.vrc-police-sheet td:last-child{text-align:end;white-space:nowrap;padding-inline-start:16px}.vrc-police-sheet p{margin:16px 0 0;opacity:.75;font-weight:400}</style><div class="vrc-police-stars"><b></b><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div><div class="vrc-police-order"></div><div class="vrc-police-sheet"><div></div></div>';
    host.appendChild(hud); starEl = hud.querySelector('.vrc-police-stars'); orderEl = hud.querySelector('.vrc-police-order'); sheet = hud.querySelector('.vrc-police-sheet');
  }
  function renderHud() { if (!starEl) return; starEl.classList.toggle('on', wanted > 0); starEl.classList.toggle('lost', wanted > 0 && !seen); starEl.querySelector('b').textContent = TX('wanted'); starEl.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i < wanted)); starEl.dir = (api?.lang || lang) === 'he' ? 'rtl' : 'ltr'; }
  function showOrder(text) { if (!orderEl) return; orderEl.textContent = '📢 ' + text; orderEl.classList.add('on'); orderHide = time + 4.5; }
  function showArrest() { if (!sheet) return; const a = arrest, esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); sheet.dir = (api?.lang || lang) === 'he' ? 'rtl' : 'ltr';
    sheet.firstElementChild.innerHTML = '<h2>' + esc(TX('arrested')) + '</h2><table>' + a.offences.map(o => '<tr><td>' + esc(o.text) + (o.n > 1 ? ' × ' + o.n : '') + '</td><td>' + (o.fine ? o.fine.toLocaleString('uk-UA') + ' ₴' : '—') + '</td></tr>').join('') + '<tr><td><b>' + esc(TX('total')) + '</b></td><td><b>' + a.fine.toLocaleString('uk-UA') + ' ₴</b></td></tr></table><p>' + esc(TX('back')) + '</p>'; sheet.classList.add('on'); if (orderEl) orderEl.classList.remove('on'); }
  function hideArrest() { if (sheet) sheet.classList.remove('on'); }

  // ---- frame ---------------------------------------------------------------------------------------------------------------------------------
  const ps = {};
  function update(dt, ctx = null, playerArg = null) {
    if (disposed || !(dt > 0)) return; dt = Math.min(dt, 0.1); time += dt;
    const camera = ctx && ctx.isCamera ? ctx : ctx && ctx.camera, pl = playerArg || (ctx && !ctx.isCamera && ctx.player) || null;
    light = typeof opts.lightMode === 'function' ? opts.lightMode() : opts.lightMode || (city && city.mode ? city.mode() : 'day');
    // the player
    let c = null; if (pl && pl.onFoot) { P.onFoot = true; P.x = pl.x; P.z = pl.z; P.vx = P.vz = P.speed = 0; P.ref = null; P.has = true; }
    else { c = pl ? carState(pl.car || pl, ps) : drive.player(); if (c) { P.onFoot = false; P.x = c.x; P.z = c.z; P.yaw = c.yaw; P.vx = c.vx; P.vz = c.vz; P.speed = c.speed; P.ref = c.ref; P.L = c.L; P.W = c.W; P.has = true; P.disabled = !!(c.ref && (c.ref.disabled || c.ref.car?.disabled)); } else if (camera) { P.onFoot = true; P.x = camera.position.x; P.z = camera.position.z; P.vx = P.vz = P.speed = 0; P.has = true; } }
    if (camera) { camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm); cam.x = camera.position.x; cam.z = camera.position.z; } else { cam.x = P.x; cam.z = P.z; }
    if (arrest) { arrest.t += dt; for (const u of units) { u.v = Math.max(0, u.v - 10 * dt); u.car.setLights(true, time, light === 'night', false); } if (arrest.t > (opts.arrestTime ?? 4.5)) finishArrest(); return; }
    if (!enabled || !P.has) return;

    // how many units, and what they do
    const want = wanted > 0 ? UNITS_AT[wanted] : (ambient ? 1 : 0), chasing = units.filter(u => !u.block).length;
    spawnT -= dt; if (chasing < want && spawnT <= 0) { spawnT = wanted > 0 ? 1.5 : 6; const u = spawnUnit(wanted > 0 ? 'respond' : 'patrol'); if (u && wanted > 0) plan(u, P.x, P.z); }
    if (wanted >= 4) { blockT -= dt; if (blockT <= 0 && blocks.length < (wanted >= 5 ? 2 : 1)) { blockT = placeRoadblock() ? 22 : 3; } }
    for (let i = blocks.length - 1; i >= 0; i--) { const b = blocks[i], d = hyp(b.x - P.x, b.z - P.z); if ((time - b.born > 50 || b.passed && d > 120 || d > 420) && hidden(b.x, b.z)) { for (const u of b.units) removeUnit(u); blocks.splice(i, 1); } }

    // seen / unseen → the level falls when nobody has seen the player for a while
    let nearest = null, nd = 1e9; seen = false;
    for (const u of units) { const d = hyp(u.x - P.x, u.z - P.z); if (d < nd) { nd = d; nearest = u; } if (d < 28 || (d < 85 && !blockedLine(u.x, u.z, P.x, P.z))) { seen = true; u.sees = true; } else u.sees = false; }
    if (wanted > 0) {
      if (seen) { if (unseen > 3) emit('police:seen', {}); unseen = 0; lastSeen = { x: P.x, z: P.z }; chaseT += dt; } else { unseen += dt; if (unseen < 5 || !lastSeen) lastSeen = { x: P.x, z: P.z }; }
      if (unseen > (opts.loseTime ?? 10 + 5 * wanted)) { unseen = 0; heat = LEVEL_HEAT[wanted - 1]; setLevel(wanted - 1, 'lost'); if (wanted === 0) lastSeen = null; }
      // running from the police makes it worse (up to level 3 by this alone)
      if (seen && P.speed > 12 && nd < 60) { fleeT += dt; if (fleeT > 14) { fleeT = 0; if (wanted < 3) report('flee', { pos: P }); else record.set('flee', (record.get('flee') || 0) + 1); } }
    } else if (ambient) {
      // a patrol car that sees extreme speeding
      for (const u of units) if (u.sees && hyp(u.x - P.x, u.z - P.z) < 45 && P.speed * 3.6 > (opts.speedLimit ?? 95) && time - (u.speedT || -99) > 6) { u.speedT = time; report('speeding', { pos: P }); }
    }
    if (starEl && wanted > 0) starEl.classList.toggle('lost', !seen);

    // stopping: the player stands (or the car is dead, or the player is on foot) with a unit close by
    const slow = P.speed < 1.6, close = nearest && nd < 16;
    if (wanted > 0 && slow && close) stopT += dt; else stopT = Math.max(0, stopT - dt * 2);
    const stopping = wanted > 0 && stopT > (opts.stopTime ?? 1.6);

    for (const u of [...units]) {
      const d = hyp(u.x - P.x, u.z - P.z), vmax = TOP_SPEED[wanted];
      if (u.mode === 'block') { u.car.setLights(true, time + u.id * 0.37, light === 'night', d < 60); for (const a of u.officers) a.face(P.x, P.z); if (stopping && d < 16 && !u.officers.some(a => a.goingTo)) { /* handled below by the stop logic of chasing units */ } contact(u, dt); place(u); continue; }
      if (wanted === 0) {
        // patrol: cruise from node to node
        if (!u.path || u.pi >= u.path.length) { const R = city.roads; let n = nodeOf(u.x, u.z), prev = u.prevNode ?? -1; const list = [n]; for (let k = 0; k < 6; k++) { const es = R.nodes[n].edges; let nx = -1, tries = 0; while (tries++ < 6) { const e = R.edges[es[Math.floor(rnd() * es.length)]], o = e.a === n ? e.b : e.a; if (o !== prev || es.length === 1) { nx = o; break; } } if (nx < 0) break; prev = n; n = nx; list.push(n); } u.prevNode = list[list.length - 2] ?? -1; u.path = list.map(i => R.nodes[i]); u.pi = 1; }
        u.mode = 'patrol'; followPath(u, 11, dt); u.car.setLights(false, time); stopSiren(u);
        if (d > 380 && hidden(u.x, u.z)) { removeUnit(u); continue; }
        if (u.stuck > 5 && hidden(u.x, u.z)) { removeUnit(u); continue; }
        if (u.officers.length) officersIn(u);
        place(u); continue;
      }
      // --- wanted: respond → chase → (pit / box) → stop
      const los = u.sees, lead = clamp(d / Math.max(12, u.v + 6), 0, 1.6);
      if (stopping && d < 22) {
        u.mode = 'stop'; u.v = Math.max(0, u.v - 12 * dt); if (u.v < 0.5) { const first = units.filter(q => q.officers.length && !q.block).length; if (!u.officers.length && first < 2) officersOut(u); }
        // officers walk to the driver's door (left side of the player's car) / to the player on foot
        let k = 0; for (const a of u.officers) { const side = P.onFoot ? 0 : (k ? -1 : 1), tx = P.x + Math.cos(P.yaw) * side * (P.W / 2 + 0.75) + Math.sin(P.yaw) * (P.onFoot ? 0.9 : 0.1) + (P.onFoot ? (k ? 0.7 : -0.7) : 0), tz = P.z - Math.sin(P.yaw) * side * (P.W / 2 + 0.75) + Math.cos(P.yaw) * (P.onFoot ? 0.9 : 0.1); a.goto(tx, tz, 1.9); a.face(P.x, P.z); a.pose(a.arrived ? 'talk' : 'stand'); a.goingTo = true; if (a.arrived && k === 0) { u.arriveT = (u.arriveT || 0) + dt; if (u.arriveT > 1.4) { doArrest(u); return; } } k++; }
        if (u.officers.length && (u.stopT = (u.stopT || 0) + dt) > 14) { doArrest(u); return; }
      } else {
        if (u.mode === 'stop') { officersIn(u); u.stopT = 0; u.arriveT = 0; u.mode = 'respond'; if (P.speed > 4) report('flee', { pos: P }); }
        const target = seen || !lastSeen ? P : lastSeen;
        if (los && d < 60 && !(u.direct > time && d > 25)) {
          // direct pursuit with a role: 0 behind, 1 / 2 alongside (box-in, PIT), 3 get ahead and brake
          u.mode = 'chase'; const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw); let ox = 0, oz = 0, vm = Math.max(vmax, 0);
          const slot = wanted >= 2 ? u.slot : 0;
          if (slot === 0) { ox = -fx * 5.2; oz = -fz * 5.2; }
          else if (slot === 1 || slot === 2) { const s = slot === 1 ? 1 : -1, al = (P.x - u.x) * fx + (P.z - u.z) * fz; ox = rx * s * 2.5 - fx * 0.6; oz = rz * s * 2.5 - fz * 0.6;
            if (Math.abs(al) < 3.5 && P.speed > 7 && wanted <= 3 && time - (u.pitT || -9) > 5) { u.mode = 'pit'; ox = rx * s * 0.9 - fx * 1.6; oz = rz * s * 0.9 - fz * 1.6; if (u.contactT === time - dt || time - u.hitT < 0.3) u.pitT = time; } }
          else { ox = fx * 9; oz = fz * 9; }
          const tx = P.x + P.vx * lead * 0.6 + ox, tz = P.z + P.vz * lead * 0.6 + oz, dd = hyp(tx - u.x, tz - u.z);
          vm = Math.min(vmax, P.speed + clamp(dd * 1.4, 0, 16)); if (slot === 3 && dd < 4) vm = Math.max(0, P.speed - 5);
          if (P.speed < 2 && d < 9) vm = 0;                                              // boxed in: hold position
          if (city && city.blocked && blockedLine(u.x, u.z, tx, tz)) { driveTo(u, P.x - fx * 5, P.z - fz * 5, vm, dt, { arrive: true }); } else driveTo(u, tx, tz, vm, dt, { arrive: P.speed < 3 });
        } else {
          u.mode = seen ? 'respond' : 'search'; if (time > u.planT || !u.path) plan(u, target.x + (seen ? P.vx * 2.5 : 0), target.z + (seen ? P.vz * 2.5 : 0));
          if (u.path && u.pi < u.path.length) followPath(u, vmax * (seen || unseen < 5 ? 1 : 0.7), dt, d < 70 ? [target.x, target.z] : null);
          else if (hyp(target.x - u.x, target.z - u.z) > 12 && !blockedLine(u.x, u.z, target.x, target.z)) driveTo(u, target.x, target.z, vmax * 0.6, dt, { arrive: true }); else { u.v = Math.max(0, u.v - 8 * dt); if (!seen && time > (u.roamT || 0)) { u.roamT = time + 6; const a = rnd() * TAU; plan(u, target.x + Math.sin(a) * 90, target.z + Math.cos(a) * 90); } }
        }
        if (u.stuck > 4 && hidden(u.x, u.z)) { removeUnit(u); continue; }
        if (d > 240 && hidden(u.x, u.z) && time - u.born > 8) { removeUnit(u); spawnT = Math.min(spawnT, 0.3); continue; }
        // loudspeaker
        if (los && d < 38 && P.speed > 3 && time > orderT) { orderT = time + 9 + rnd() * 4; const plate = P.ref && (P.ref.plate || P.ref.car?.plate || P.ref.model?.plate), text = plate ? TX('orderPlate').replace('{p}', plate) : TX('order'); audio.speaker?.(u.x, u.z); showOrder(text); emit('police:order', { text, unit: u }); }
      }
      contact(u, dt);
      u.car.setLights(true, time + u.id * 0.37, light === 'night', d < 70 && units.indexOf(u) < 2);
      if (!u.siren && u.mode !== 'stop') u.siren = audio.siren('police' + u.id, u.x, u.z, d < 40 ? 'yelp' : 'wail'); else if (u.siren) { if (u.mode === 'stop') stopSiren(u); else u.siren.move(u.x, u.z); }
      place(u);
    }
    if (orderEl && orderHide && time > orderHide) { orderEl.classList.remove('on'); orderHide = 0; }
  }
  function place(u) { u.doorK = (u.doorK || 0) + clamp((u.doorT || 0) - (u.doorK || 0), -dt60 * 3, dt60 * 3); u.car.setDoors(u.doorK); u.car.group.position.set(u.x, 0, u.z); u.car.group.rotation.y = u.yaw; u.vx = Math.sin(u.yaw) * u.v; u.vz = Math.cos(u.yaw) * u.v; }
  const dt60 = 1 / 60;

  // ---- wiring to people.js (offences seen by the people module) ----------------------------------------------------------------------------
  const subs = [];
  if (people && opts.autoReport !== false) {
    const on = (e, f) => { people.on(e, f); subs.push([e, f]); };
    on('people:hit', e => { if (e.byPlayer === false) return; report(e.severity === 'light' ? 'nudge' : e.severity === 'medium' ? 'hit' : e.severity === 'body' ? 'body' : 'hitHard', { pos: e.pos }); });
    on('people:down', e => { if (e.dead) report('kill', { pos: e.pos }); });
    on('people:carjack', e => report('carjack', { pos: e.pos }));
    on('people:call-police', e => report('witness', { pos: e.pos }));
  }
  if (opts.autoReport !== false) drive.on('drive:collision', e => { if (!e) return; const o = e.other; if (o && typeof o === 'object' && !o.building && (e.hard || (e.speed || 0) > 3) && (o.path != null || String(o.id || '').startsWith('traffic'))) report('crash', { pos: P }); });

  let api = null;
  api = { group: root, units, log, lang,
    update, report, on(evt, cb) { (L[evt] = L[evt] || []).push(cb); return api; }, off(evt, cb) { L[evt] = (L[evt] || []).filter(f => f !== cb); return api; },
    get wanted() { return wanted; }, get heat() { return heat; }, get seen() { return seen; }, get arresting() { return !!arrest; }, get offences() { return Object.fromEntries(record); },
    setWanted(n) { heat = LEVEL_HEAT[clamp(Math.round(n), 0, 5)]; setLevel(n, 'set'); }, clear() { setLevel(0, 'clear'); heat = 0; for (const u of [...units]) if (u.mode !== 'patrol') removeUnit(u); },
    setEnabled(on) { enabled = !!on; if (!on) api.clear(); }, setLang(l) { api.lang = l; renderHud(); },
    /** Boxes of the patrol cars for the car physics of the driving code: → [{ x, z, yaw, L, W, v, unit }] */
    colliders() { return units.map(u => ({ x: u.x, z: u.z, yaw: u.yaw, L: u.L, W: u.W, v: u.v, unit: u })); },
    spawnUnit, placeRoadblock, state: () => ({ wanted, heat: +heat.toFixed(2), seen, unseen: +unseen.toFixed(1), units: units.map(u => ({ id: u.id, mode: u.mode, x: +u.x.toFixed(1), z: +u.z.toFixed(1), v: +u.v.toFixed(1), d: +hyp(u.x - P.x, u.z - P.z).toFixed(1), officers: u.officers.length })), blocks: blocks.length, arrest: arrest ? +arrest.t.toFixed(1) : null }),
    dispose() { disposed = true; for (const u of [...units]) removeUnit(u); for (const [e, f] of subs) people.off(e, f); if (hud) hud.remove(); if (ownAudio) audio.dispose(); root.parent?.remove(root); },
  };
  renderHud();
  return api;
}
