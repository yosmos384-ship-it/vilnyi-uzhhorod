// people.js — pedestrians, drivers and bodies of the open-city driving mode (V8-people).
// createPeople(scene, { city, drive, gore, seed, budget, lightMode, audio, carSpec }) → the population object (API at the end,
// integration recipe in notes/V8-people.md). All people are fictional and generated from seeds (people-face.js / people-body.js).
// Three detail tiers: near = one SkinnedMesh per person with a painted face; mid and far = two InstancedMesh whose limbs are
// swung in the vertex shader. This module edits nobody's files: the city and the driving code are reached through
// people-adapters.js only.
import * as THREE from 'three';
import { makeTraits, makeFigure, skeleton, paletteOf, variantsOf, templateGeometry, instancedMaterial, poseWalk, poseStatic, newPose, POSE_ID, POSE_N, PAL_W, makePerson, rng } from './people-body.js';
import { cityAdapter, driveAdapter, carState } from './people-adapters.js';
import { createPeopleAudio } from './people-audio.js';
import { createProps } from './people-props.js';
export { makePerson, makeTraits };

const TAU = Math.PI * 2, hyp = Math.hypot, clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const hash = (a, b = 0) => { let h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x7F4A7C15, 0xC2B2AE35); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return (h >>> 0) / 4294967296; };

// strings the host may show (module-local dictionary, seven languages)
export const PEOPLE_STRINGS = {
  uk: { pullOut: 'Витягнути водія', resists: 'Водій чинить опір!', called: 'Свідок викликав поліцію', thrown: 'Вас витягли з авто' },
  en: { pullOut: 'Pull the driver out', resists: 'The driver fights back!', called: 'A witness called the police', thrown: 'You were pulled out of the car' },
  he: { pullOut: 'להוציא את הנהג', resists: 'הנהג מתנגד!', called: 'עד ראייה הזעיק משטרה', thrown: 'הוציאו אותך מהרכב' },
  ro: { pullOut: 'Scoate șoferul', resists: 'Șoferul se opune!', called: 'Un martor a chemat poliția', thrown: 'Ai fost scos din mașină' },
  de: { pullOut: 'Fahrer herausziehen', resists: 'Der Fahrer wehrt sich!', called: 'Ein Zeuge hat die Polizei gerufen', thrown: 'Sie wurden aus dem Auto gezogen' },
  fr: { pullOut: 'Sortir le conducteur', resists: 'Le conducteur résiste !', called: 'Un témoin a appelé la police', thrown: 'On vous a sorti de la voiture' },
  it: { pullOut: 'Tira fuori il conducente', resists: 'Il conducente reagisce!', called: 'Un testimone ha chiamato la polizia', thrown: 'Sei stato tirato fuori dall\'auto' },
};
export const peopleText = (key, lang = 'uk') => (PEOPLE_STRINGS[lang] || PEOPLE_STRINGS.uk)[key] ?? PEOPLE_STRINGS.uk[key] ?? key;

const MOVING = { walk: 1, cross: 1, enter: 1, exit: 1, flee: 1, dodge: 1, actor: 1, fight: 1, jog: 1 };
const FREE = { flee: 1, dodge: 1, stumble: 1, fight: 1, actor: 1 };
const UPRIGHT_BUSY = { rag: 1, down: 1, getup: 1, dead: 1, seat: 1, pulled: 1, stumble: 1 };

export function createPeople(scene, opts = {}) {
  let city = cityAdapter(opts.city, opts.cityOptions), drive = driveAdapter(opts.drive, { carSpec: opts.carSpec });
  const B = Object.assign({ max: 220, near: 12, nearR: 13, mid: 40, midR: 34, radius: 150, perMetre: 0.03, faceSize: 256, occupants: 16, bodyTime: 50, decals: 48, simR: 70 }, opts.budget || {});
  const settings = opts.settings || null; let dens = 1;
  let gore = settings && settings.blood != null ? !!settings.blood : opts.gore !== false, time = 0, frame = 0, nextId = 1, light = typeof opts.lightMode === 'string' ? opts.lightMode : 'day', warm = true, disposed = false;
  const seed0 = (opts.seed ?? 20261008) >>> 0, rnd = rng(seed0 ^ 0xBEEF), audio = opts.audio || createPeopleAudio();
  const L = {}, emit = (evt, d) => { (L[evt] || []).forEach(cb => { try { cb(d); } catch (e) { console.error(e); } }); if (opts.domEvents && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(evt, { detail: d })); };
  const root = new THREE.Group(); root.name = 'vrc-people'; scene.add(root);
  const people = [], cars = [], anchors = new Map(), stat = { ms: 0, spawned: 0, entered: 0, hits: 0, built: 0, calls: 0, tris: 0, near: 0, mid: 0, far: 0 };

  // ---- palette rows + instanced tiers ----------------------------------------------------------------------------------------------------
  const ROWS = 512, palData = new Uint8Array(PAL_W * ROWS * 4), palTex = new THREE.DataTexture(palData, PAL_W, ROWS, THREE.RGBAFormat);
  palTex.magFilter = palTex.minFilter = THREE.NearestFilter; palTex.needsUpdate = true;
  const freeRows = []; for (let i = ROWS - 1; i >= 0; i--) freeRows.push(i);
  function setRow(row, T) { const P = paletteOf(T); for (let k = 0; k < PAL_W; k++) { const c = P[k], o = (row * PAL_W + k) * 4; palData[o] = Math.round(clamp(c[0]) * 255); palData[o + 1] = Math.round(clamp(c[1]) * 255); palData[o + 2] = Math.round(clamp(c[2]) * 255); palData[o + 3] = 255; } palTex.needsUpdate = true; }
  function makeTier(lod, cap) {
    const geo = templateGeometry(lod), mat = instancedMaterial(palTex, geo), mesh = new THREE.InstancedMesh(geo, mat, cap);
    const iA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), iV = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    iA.setUsage(THREE.DynamicDrawUsage); iV.setUsage(THREE.DynamicDrawUsage); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iA', iA); geo.setAttribute('iV', iV);
    mesh.frustumCulled = false; mesh.count = 0; mesh.name = 'vrc-people-tier' + lod; root.add(mesh);
    return { mesh, geo, mat, iA, iV, cap, n: 0, tris: geo.userData.tris, h: geo.userData.height };
  }
  const CAP = B.max + B.occupants * 2 + 24, mid = makeTier(1, CAP), far = makeTier(2, CAP);
  // blob shadows
  const shTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
  const shGeo = new THREE.PlaneGeometry(1, 1); shGeo.rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), CAP);
  shadows.frustumCulled = false; shadows.count = 0; shadows.name = 'vrc-people-shadows'; shadows.renderOrder = 1; root.add(shadows);

  // ---- blood decals (only with gore on) --------------------------------------------------------------------------------------------------------
  const decTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'), r = rng(77);
    for (let q = 0; q < 4; q++) { const ox = (q % 2) * 128 + 64, oy = (q >> 1) * 128 + 64; for (let i = 0; i < (q === 3 ? 60 : 26); i++) { const a = r() * TAU, d = Math.pow(r(), q === 3 ? 0.6 : 1.4) * (q === 3 ? 52 : 34), rr = (q === 3 ? 1.5 + r() * 4 : 6 + r() * 16) * (1 - d / 70), x = ox + Math.cos(a) * d * (q === 1 ? 1.5 : 1), y = oy + Math.sin(a) * d * (q === 1 ? 0.5 : 1);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); } }
    return new THREE.CanvasTexture(cv); })();
  const decMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, uniforms: { map: { value: decTex }, uLight: { value: 1 } },
    vertexShader: 'attribute vec4 iD; varying vec2 vUv; varying float vA;\nvoid main() { vUv = (uv + vec2(mod(iD.y, 2.0), floor(iD.y / 2.0))) * 0.5; vA = iD.x; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float uLight; varying vec2 vUv; varying float vA;\nvoid main() { float a = texture2D(map, vUv).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.16, 0.006, 0.008) * uLight, a * 0.92);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
  const decGeo = new THREE.PlaneGeometry(1, 1); decGeo.rotateX(-Math.PI / 2);
  const decals = new THREE.InstancedMesh(decGeo, decMat, B.decals), decD = new THREE.InstancedBufferAttribute(new Float32Array(B.decals * 4), 4); decD.setUsage(THREE.DynamicDrawUsage); decGeo.setAttribute('iD', decD);
  decals.frustumCulled = false; decals.count = 0; decals.name = 'vrc-people-decals'; decals.renderOrder = 2; root.add(decals);
  const decList = [], carDecals = [];
  function addDecal(x, z, size, variant, life = 70, grow = 0) { if (!gore) return null; if (decList.length >= B.decals) decList.shift(); const d = { x, z, y: 0.022 + decList.length * 0.0004, size, v: variant, born: time, life, grow, rot: rnd() * TAU }; decList.push(d); return d; }
  function addCarDecal(car, lx, ly, lz, size, facing) {
    const obj = drive.object(car.ref || car); if (!gore || !obj) return;
    const t = decTex.clone(); t.repeat.set(0.5, 0.5); t.offset.set(rnd() < 0.5 ? 0 : 0.5, 0.5); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ alphaMap: t, color: 0x3a0406, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.position.set(lx, ly, lz); if (facing === 'up') m.rotation.x = -Math.PI / 2; m.name = 'vrc-people-car-decal'; obj.add(m); carDecals.push({ m, t, born: time, life: 60 });
  }

  // ---- things people have with them (cane, pram, dog on a lead, bicycle, e-scooter) ---------------------------------------------------------------
  const props = createProps(root, 64), dropped = [];
  const DOGC = [0x6b4a2e, 0x2a2420, 0xd9c7a3, 0xf1ede4, 0x8a6a45, 0x4a4a4a], PRAMC = [0x2c3e5a, 0x5a2c35, 0x3a5a44, 0x55555a, 0xb9ad98], BIKEC = [0xc0392b, 0x2e6fb0, 0x2f8f5a, 0xe2b21f, 0xdddddd, 0x26262a];
  /** Give a walker something to have with them, by age and chance. */
  function equip(p, park = false) {
    const a = p.T.ageYears, u = hash(p.T.seed, 91), day = !lateHour();
    if (a > 68 && u < 0.5) { p.prop = 'cane'; p.want = Math.min(p.want, 0.95); }
    else if (a >= 22 && a <= 44 && day && u < 0.045) { p.prop = 'pram'; p.col = PRAMC[p.id % PRAMC.length]; p.want = Math.min(p.want, 1.15); }
    else if (a >= 15 && u > 0.92) { p.prop = 'dog'; p.col = DOGC[p.id % DOGC.length]; p.dog = { size: 0.55 + hash(p.id, 5) * 0.65, side: hash(p.id, 6) < 0.5 ? 1 : -1 }; }
    else if (a >= 14 && a <= 62 && u > (park ? 0.8 : 0.875) && u <= 0.92) { const bike = hash(p.id, 7) < 0.6; p.prop = bike ? 'bike' : 'scooter'; p.ride = true; p.col = BIKEC[p.id % BIKEC.length]; p.pose = bike ? 'drive' : 'push'; p.want = bike ? 4 + hash(p.id, 8) * 1.8 : 3.4 + hash(p.id, 8) * 1.2; p.speed = p.want; p.y = bike ? 0.93 - (p.K.J[0][1] - p.K.legU * 0.82) : 0.16; p.T.acc.bag = p.T.acc.bag === 'hand' ? null : p.T.acc.bag; p.vr = variantsOf(p.T); }
  }
  function dropProp(p) {
    if (!p.prop) return; const k = p.prop; p.prop = null;
    if (k === 'bike' || k === 'scooter') { dropped.push({ kind: k, x: p.x, z: p.z, y: k === 'bike' ? 0.03 : 0.08, yaw: p.yaw + 0.4, scale: 1, col: p.col, roll: Math.PI / 2 * (hash(p.id, 3) < 0.5 ? 1 : -1) * 0.97, until: time + 60 }); p.ride = false; p.y = 0; p.pose = 'stand'; }
    else if (k === 'cane') dropped.push({ kind: k, x: p.x + 0.4, z: p.z + 0.2, y: 0.02, yaw: p.yaw + 1, scale: 1, col: 0xffffff, roll: Math.PI / 2, until: time + 60 });
    else if (k === 'dog') dropped.push({ kind: k, x: p.dogX ?? p.x + 0.6, z: p.dogZ ?? p.z + 0.4, y: 0, yaw: Math.atan2(p.x - (p.dogX ?? p.x), p.z - (p.dogZ ?? p.z)), scale: p.dog.size, col: p.col, roll: 0, until: time + 45 });
  }
  /** Children and people with a pram are never run over: they get out of the way of any car (content rule of this module). */
  const spared = p => p.T.ageYears < 14 || p.prop === 'pram';
  function shove(p, c, lx, fx, fz, hw) { const sd = lx >= 0 ? 1 : -1, push = Math.max(0, hw + 0.45 - Math.abs(lx)); p.x += -fz * sd * push; p.z += fx * sd * push; p.fx = c.x; p.fz = c.z; if (p.anchor) { p.anchor.p = null; p.anchor = null; } if (p.state !== 'dodge') { p.tx = p.x + -fz * sd * 1.6; p.tz = p.z + fx * sd * 1.6; setState(p, 'dodge'); p.until = time + 0.6; } }

  // ---- persons --------------------------------------------------------------------------------------------------------------------------------
  function addPerson(T, x, z, yaw, state = 'walk') {
    const K = skeleton(T), row = freeRows.pop() ?? 0; setRow(row, T);
    const sy = T.height / mid.h, sxz = sy * (1 + 0.13 * T.build) * (T.gender === 'm' ? 1.05 : 0.97);
    const p = { id: nextId++, T, K, row, x, y: 0, z, yaw, vx: 0, vz: 0, speed: 0, want: T.speed, state, st: 0, until: 0, phase: rnd() * TAU, amp: 0, pose: 'stand', route: null, fig: null, tier: 2, d2: 1e9, vis: false,
      hp: 1, anchor: null, car: null, seat: null, rd: null, sxz, sy, vr: variantsOf(T), P: newPose(), look: null, lookT: 0, limp: 0, lastHit: -99, dodgeAt: 0, tx: 0, tz: 0, born: time, gone: false, pitch: 0, roll: 0, role: T.role, calm: 0 };
    people.push(p); stat.spawned++; return p;
  }
  function removePerson(p) { if (p.gone) return; p.gone = true; freeRows.push(p.row); if (p.fig) { p.fig.dispose(); p.fig = null; } if (p.anchor) { p.anchor.p = null; } if (p.car) { if (p.car.driver === p) p.car.driver = null; if (p.car.passenger === p) p.car.passenger = null; } }
  const lateHour = () => { const h = city ? city.hours() : 12; return h >= 20.5 || h < 6.5; };
  /** Traits of a passer-by: no children on the streets late in the evening and at night. */
  function civil(o = {}) { let T = makeTraits(newSeed(), o); if (T.ageYears < 14 && lateHour()) T = makeTraits(newSeed(), { ...o, age: 17 + rnd() * 50 }); return T; }
  const newSeed = () => (seed0 + Math.imul(nextId, 7919) + Math.floor(rnd() * 1e6)) >>> 0;

  // ---- routes on the pavement graph ------------------------------------------------------------------------------------------------------------
  const ends = (e, dir) => dir > 0 ? [city.nodes[e.a], city.nodes[e.b]] : [city.nodes[e.b], city.nodes[e.a]];
  function routePoint(r, ahead, out) { const e = city.edges[r.e], [A, Z] = ends(e, r.dir), ux = (Z.x - A.x) / e.len, uz = (Z.z - A.z) / e.len, s = Math.min(e.len, r.s + ahead); out[0] = A.x + ux * s - uz * r.lat; out[1] = A.z + uz * s + ux * r.lat; return out; }
  /** How far a walker may keep to either side of the edge's centre line without touching a wall or the carriageway (cached on the edge). */
  function clearance(e) {
    if (e.cl) return e.cl; const A = city.nodes[e.a], Z = city.nodes[e.b], ux = (Z.x - A.x) / e.len, uz = (Z.z - A.z) / e.len, half = Math.max(0.15, e.w / 2 - 0.35), cross = e.kind === 'cross';
    const at = (t, L) => [A.x + (Z.x - A.x) * t - uz * L, A.z + (Z.z - A.z) * t + ux * L], nS = clamp(Math.ceil(e.len / 2.5), 3, 14), wall = L => { for (let k = 0; k <= nS; k++) { const q = at(0.06 + 0.88 * k / nS, L); if (city.blocked && city.blocked(q[0], q[1])) return true; } return false; };
    const mid = at(0.5, 0), road0 = !cross && city.onRoad(mid[0], mid[1]), road = L => { if (cross || road0) return false; for (const t of [0.2, 0.5, 0.8]) { const q = at(t, L); if (city.onRoad(q[0], q[1])) return true; } return false; };
    const side = sg => { for (const k of [1, 0.6, 0.3]) { const L = sg * half * k; if (!wall(L * 1.25) && !road(L * 1.25)) return half * k; } return 0.05; };
    return e.cl = { p: side(1), n: side(-1), bad: wall(0), road: road0 };
  }
  const clampLat = (e, dir, lat) => { const c = clearance(e); return clamp(lat * dir, -c.n, c.p) * dir; };
  function latFor(e, p, dir = 1) { const half = Math.max(0.15, e.w / 2 - 0.35); return clampLat(e, dir, e.kind === 'plaza' ? (hash(p.id, 5) * 2 - 1) * half : lerp(0.1, half, hash(p.id, 3))); }
  function startRoute(p, ei, dir, s = 0) { const e = city.edges[ei]; p.route = { e: ei, dir, s, lat: latFor(e, p, dir), latT: 0 }; p.route.latT = p.route.lat; }
  function nextEdge(p) {
    const r = p.route, e = city.edges[r.e], node = r.dir > 0 ? e.b : e.a, h = city.hours(), jog = p.role === 'jogger';
    let tot = 0; const c = []; for (const ei of city.adj[node]) { if (ei === r.e) continue; const q = city.edges[ei]; let w = city.density(q, h) + 0.04; if (q.kind === 'cross') w *= jog ? 0.05 : 0.45; if (jog && q.park) w *= 8; if (e.kind === 'cross' && q.kind === 'cross') w *= 0.15; if (clearance(q).bad) { if (clearance(e).bad) w *= 0.3; else continue; } c.push(ei, w); tot += w; }
    if (!c.length) { r.dir = -r.dir; r.s = 0; return; }
    let x = rnd() * tot, pick = c[0]; for (let i = 0; i < c.length; i += 2) { x -= c[i + 1]; if (x <= 0) { pick = c[i]; break; } }
    const q = city.edges[pick]; r.e = pick; r.dir = q.a === node ? 1 : -1; r.s = 0; r.latT = latFor(q, p, r.dir); r.lat = clampLat(q, r.dir, r.lat);
    if (q.kind === 'cross') { setState(p, 'wait'); p.until = time + 0.4 + rnd() * 1.2; p.pose = 'stand'; }
    else if (p.state === 'cross') setState(p, 'walk');
    // sometimes: stop to look at the phone, or go into an open shop
    if (p.state === 'walk' && p.role === 'civil' && !p.ride && p.prop !== 'pram') {
      const u = rnd();
      if (u < 0.035 && p.T.acc.phone) { setState(p, 'idle'); p.pose = 'phone'; p.until = time + 4 + rnd() * 7; }
      else if (u < 0.1) { const ps = city.poisNear(p.x, p.z, 16); for (const poi of ps) if (city.isOpen(poi) && rnd() < 0.5) { setState(p, 'enter'); p.tx = poi.x + (poi.nx || 0) * 0.4; p.tz = poi.z + (poi.nz || 0) * 0.4; p.poi = poi; break; } }
    }
  }
  function setState(p, s) { p.state = s; p.st = 0; }
  const tmpPt = [0, 0];
  function steer(p, tx, tz, speed, dt, turn = 5) {
    const dx = tx - p.x, dz = tz - p.z, d = hyp(dx, dz); if (d < 1e-4) { p.speed = 0; return d; }
    const want = Math.atan2(dx, dz), da = angDiff(want, p.yaw); p.yaw += clamp(da, -turn * dt, turn * dt);
    const align = Math.max(0.15, Math.cos(da)); p.speed += clamp(speed * align - p.speed, -4 * dt, 2.5 * dt);
    const st = Math.min(d, p.speed * dt); p.x += dx / d * st; p.z += dz / d * st; return d;
  }
  function followRoute(p, dt, speed) {
    const r = p.route, e = city.edges[r.e], [A, Z] = ends(e, r.dir), ux = (Z.x - A.x) / e.len, uz = (Z.z - A.z) / e.len;
    r.lat += clamp(r.latT - r.lat, -0.8 * dt, 0.8 * dt);
    r.s = clamp((p.x - A.x) * ux + (p.z - A.z) * uz, r.s, e.len);
    routePoint(r, 1.3, tmpPt); steer(p, tmpPt[0], tmpPt[1], speed, dt);
    if (r.s >= e.len - 0.35) nextEdge(p);
  }
  function rejoin(p) { const ne = city.nearestEdge(p.x, p.z, 60); if (!ne) { removePerson(p); return; } const e = city.edges[ne.edge]; startRoute(p, ne.edge, rnd() < 0.5 ? 1 : -1, 0); p.route.s = p.route.dir > 0 ? ne.t * e.len : (1 - ne.t) * e.len; setState(p, e.kind === 'cross' ? 'cross' : 'walk'); p.want = p.T.speed * (p.limp ? 0.55 : 1); }

  // ---- spawn / despawn around the camera -------------------------------------------------------------------------------------------------------
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(), cam = { x: 0, y: 0, z: 0, yaw: 0 }, near = [];
  const inView = (x, z, r = 1.3) => { sph.center.set(x, 1, z); sph.radius = r; return frustum.intersectsSphere(sph); };
  const hiddenAt = (x, z) => { const d = hyp(x - cam.x, z - cam.z); return warm || d > 95 || (d > 14 && !inView(x, z, 2)); };
  let spawnT = 0, anchorT = 0;
  function spawnTick() {
    if (!city) return; const h = city.hours(), R = B.radius, T0 = performance.now();
    const list = city.edgesNear(cam.x, cam.z, R, near), cnt = new Map(); let total = 0, walkers = 0;
    for (const p of people) { if (p.gone) continue; total++; if (p.route && !p.anchor && !p.car) { cnt.set(p.route.e, (cnt.get(p.route.e) || 0) + 1); walkers++; } }
    // despawn: far away, or surplus out of view
    for (const p of people) { if (p.gone || p.car || p.state === 'actor' || p.keep) continue; const d = hyp(p.x - cam.x, p.z - cam.z);
      if (d > R + 30) { if (!UPRIGHT_BUSY[p.state] || d > R + 60) removePerson(p); }
      else if (p.state === 'dead' && time - p.deadAt > B.bodyTime && (!p.vis || time - p.deadAt > B.bodyTime * 2.2)) removePerson(p);
      else if (p.route && !p.anchor && d > 40 && !p.vis && p.state === 'walk') { const e = city.edges[p.route.e], want = e.len * city.density(e, h) * B.perMetre * dens; if ((cnt.get(p.route.e) || 0) > want + 1.2 && rnd() < 0.3) { cnt.set(p.route.e, cnt.get(p.route.e) - 1); removePerson(p); } } }
    // spawn where the pavement has fewer walkers than its place and the hour want
    let made = 0; const lim = warm ? 400 : 5;
    for (let k = 0; k < list.length && made < lim && total < B.max; k++) {
      const ei = list[(k + (frame * 7)) % list.length], e = city.edges[ei]; if (e.kind === 'cross') continue;
      if (e.len * city.density(e, h) * B.perMetre * dens - (cnt.get(ei) || 0) <= 0) continue; if (clearance(e).bad) continue;
      const want = e.len * city.density(e, h) * B.perMetre * dens, have = cnt.get(ei) || 0, need = want - have; if (need <= 0 || rnd() > need) continue;
      const t = rnd(), A = city.nodes[e.a], Z = city.nodes[e.b], x = lerp(A.x, Z.x, t), z = lerp(A.z, Z.z, t);
      if (hyp(x - cam.x, z - cam.z) > R || !hiddenAt(x, z)) continue;
      const jog = e.park && rnd() < 0.3, T = civil(jog ? { role: 'jogger' } : {}), dir = rnd() < 0.5 ? 1 : -1, p = addPerson(T, x, z, 0, 'walk');
      startRoute(p, ei, dir, 0); p.route.s = dir > 0 ? t * e.len : (1 - t) * e.len; p.want = jog ? 2.6 + rnd() * 0.8 : T.speed; if (!jog && T.ageYears >= 12) equip(p, !!e.park); const [a, b] = ends(e, dir); p.yaw = Math.atan2(b.x - a.x, b.z - a.z); routePoint(p.route, 0, tmpPt); p.x = tmpPt[0]; p.z = tmpPt[1]; p.speed = p.want;
      cnt.set(ei, have + 1); made++; total++;
      // a child does not walk alone: an adult goes with it (the child keeps to the adult's side)
      if (T.ageYears < 12 && !jog) { const A = addPerson(makeTraits(newSeed(), { age: 26 + rnd() * 22 }), p.x, p.z, p.yaw, 'walk'); startRoute(A, ei, dir, 0); A.route.s = p.route.s; A.want = Math.min(A.T.speed, 1.15); A.speed = A.want; routePoint(A.route, 0, tmpPt); A.x = tmpPt[0]; A.z = tmpPt[1]; p.buddy = A; p.side = rnd() < 0.5 ? 1 : -1; p.x = A.x + Math.cos(p.yaw) * 0.5 * p.side; p.z = A.z - Math.sin(p.yaw) * 0.5 * p.side; total++; }
    }
    // people coming out of open shops near the camera (the one legitimate way to appear in view)
    if (!warm && total < B.max && rnd() < 0.35) { const ps = city.poisNear(cam.x, cam.z, 70); if (ps.length) { const poi = ps[Math.floor(rnd() * ps.length)]; if (city.isOpen(poi) && rnd() < timeFactor01(h)) { const ne = city.nearestEdge(poi.x, poi.z, 12); if (ne) { const p = addPerson(civil({ age: 15 + rnd() * 60 }), poi.x + (poi.nx || 0) * 0.4, poi.z + (poi.nz || 0) * 0.4, Math.atan2(poi.nx || 0, poi.nz || 1), 'exit'); p.tx = ne.x; p.tz = ne.z; p.exitEdge = ne; } } } }
    const T1 = performance.now(); warmAnchors(h); stat.spawnMs = +(T1 - T0).toFixed(2); stat.anchorMs = +(performance.now() - T1).toFixed(2);
    warm = false;
  }
  const timeFactor01 = h => clamp(city.density({ busy: 1, night: 1, kind: 'pave', len: 1, a: 0, b: 0, id: -1 }, h), 0.05, 1);
  // fixed places: benches, bus stops, café terraces, shop staff, people standing in groups on squares
  function anchorsFor(h) {
    const R = Math.min(B.radius, 110), out = [];
    const add = (key, x, z, yaw, pose, role, prob, extra) => { if (hyp(x - cam.x, z - cam.z) > R) return; if (!anchors.has(key) && city.blocked && city.blocked(x, z)) return; let a = anchors.get(key); if (!a) { a = { key, x, z, yaw, pose, role, p: null, ...extra }; anchors.set(key, a); } a.prob = prob; a.seen = frame; out.push(a); };
    const tf = timeFactor01(h);
    (city.benches || []).forEach((b, i) => { add('b' + i + 'a', b.x - Math.cos(b.yaw) * 0.38, b.z + Math.sin(b.yaw) * 0.38, b.yaw, 'sit', 'civil', 0.4 * tf); add('b' + i + 'b', b.x + Math.cos(b.yaw) * 0.38, b.z - Math.sin(b.yaw) * 0.38, b.yaw, 'sit', 'civil', 0.22 * tf); });
    (city.busStops || []).forEach((b, i) => { for (let k = 0; k < 5; k++) add('s' + i + '_' + k, b.x + Math.cos(b.yaw) * (k - 2) * 0.85, b.z - Math.sin(b.yaw) * (k - 2) * 0.85, b.yaw, k === 2 ? 'sit' : (k % 2 ? 'phone' : 'stand'), 'civil', (k === 2 ? 0.5 : 0.42) * Math.max(tf, 0.12), { bus: true }); });
    for (const poi of city.poisNear(cam.x, cam.z, R)) {
      const open = city.isOpen(poi), nx = poi.nx || 0, nz = poi.nz || 1, id = poi.id ?? (poi.x * 31 + poi.z);
      if (!open) continue;
      const cat = poi.cat || poi.kind || 'shop', yaw = Math.atan2(nx, nz);
      if (cat !== 'atm' && cat !== 'church' && cat !== 'fuel') add('st' + id, poi.x + nx * 0.45 + nz * 1.25, poi.z + nz * 0.45 - nx * 1.25, yaw + 0.3, hash(id | 0, 3) < 0.5 ? 'phone' : 'stand', cat === 'cafe' || cat === 'restaurant' || cat === 'bar' ? 'waiter' : 'staff', 0.3, { poi });
      // café terrace: the seats are the stools city.js draws (tables at door + n · 1.7 + t · k · 1.9, stools at ± 0.62 along the wall)
      if (poi.terrace && !(poi.b < 0)) { const tx = nz, tz = -nx; for (let k = -1; k <= 1; k++) { if (poi.fw != null && Math.abs(k) * 1.9 > poi.fw / 2 + 1.5) continue; for (const e of [-0.62, 0.62]) add('t' + id + '_' + k + (e > 0 ? 'a' : 'b'), poi.x + nx * 1.7 + tx * (k * 1.9 + e), poi.z + nz * 1.7 + tz * (k * 1.9 + e), Math.atan2(-tx * e, -tz * e), 'sit', 'civil', 0.55 * Math.max(tf, 0.25), { poi, terrace: true }); }
        add('w' + id, poi.x + nx * 0.75, poi.z + nz * 0.75, yaw + 0.5, 'stand', 'waiter', 0.9, { poi, waiter: true }); }
    }
    // standing groups on squares
    for (const ei of city.edgesNear(cam.x, cam.z, R, near)) { const e = city.edges[ei]; if (e.kind !== 'plaza') continue; const n = Math.floor(e.len / 14); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, A = city.nodes[e.a], Z = city.nodes[e.b], off = (hash(ei, k) * 2 - 1) * e.w * 0.45, ux = (Z.x - A.x) / e.len, uz = (Z.z - A.z) / e.len, x = lerp(A.x, Z.x, t) - uz * off, z = lerp(A.z, Z.z, t) + ux * off, a0 = hash(ei, k + 50) * TAU;
      add('g' + ei + '_' + k + 'a', x + Math.sin(a0) * 0.42, z + Math.cos(a0) * 0.42, a0 + Math.PI, 'talk', 'civil', 0.5 * tf, { pair: 'g' + ei + '_' + k }); add('g' + ei + '_' + k + 'b', x - Math.sin(a0) * 0.42, z - Math.cos(a0) * 0.42, a0, hash(ei, k + 9) < 0.5 ? 'stand' : 'phone', 'civil', 0.5 * tf, { pair: 'g' + ei + '_' + k }); } }
    return out;
  }
  function warmAnchors(h) {
    const hb = Math.floor(h * 2);
    for (const a of anchorsFor(h)) {
      const on = hash(strHash(a.pair || a.key), hb) < a.prob;
      if (on && !a.p && people.length < B.max + 60 && hiddenAt(a.x, a.z)) { const T = makeTraits(newSeed(), a.role === 'civil' ? { age: a.pose === 'sit' && a.bus ? 62 + rnd() * 18 : (lateHour() ? 18 : 15) + rnd() * (lateHour() ? 40 : 60) } : { role: a.role }); const p = addPerson(T, a.x, a.z, a.yaw, 'anchor'); p.pose = a.pose; p.anchor = a; a.p = p; }
      else if (!on && a.p && !a.p.vis && a.p.state === 'anchor') removePerson(a.p);
    }
    for (const [k, a] of anchors) if (a.seen !== frame) { if (a.p && !a.p.vis && a.p.state === 'anchor') removePerson(a.p); if (!a.p) anchors.delete(k); }
  }
  const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---- reactions -----------------------------------------------------------------------------------------------------------------------------------
  function lookAt(p, x, z, dur = 1.6) { p.look = [x, z]; p.lookT = time + dur; }
  function react(p, kind, fx, fz, dur) {
    if (p.gone || UPRIGHT_BUSY[p.state] || p.state === 'actor' || p.car) return;
    p.fx = fx; p.fz = fz; lookAt(p, fx, fz, 3);
    if (kind === 'flee') { setState(p, 'flee'); p.until = time + (dur || 6 + rnd() * 5); p.want = clamp(p.T.speed * 2.6, 2.2, 4.6); if (p.anchor) { p.anchor.p = null; p.anchor = null; } }
    else { if (p.anchor && p.pose === 'sit') { lookAt(p, fx, fz, 4); return; } setState(p, kind); p.until = time + (dur || 3 + rnd() * 4); p.pose = kind === 'film' ? 'film' : kind === 'shout' ? 'shout' : kind === 'cower' ? 'cower' : 'stand'; p.yaw0 = Math.atan2(fx - p.x, fz - p.z); }
  }
  /** Everybody who saw something at (x, z): run away / film it / shout / freeze, by temperament. n = how alarming (0..1). */
  function alarm(x, z, n = 1, radius = 26, except = null) {
    let seen = 0;
    for (const p of people) { if (p.gone || p === except || p.car) continue; const d = hyp(p.x - x, p.z - z); if (d > radius) continue; seen++;
      const u = hash(p.id, 77), near1 = d < 9;
      if (u < 0.5 * n || (near1 && u < 0.7 * n)) react(p, 'flee', x, z); else if (u < 0.5 * n + 0.2 && p.T.acc.phone) react(p, 'film', x, z, 6 + rnd() * 6); else if (u < 0.5 * n + 0.32) react(p, 'shout', x, z, 2.5); else if (u < 0.5 * n + 0.4) react(p, 'cower', x, z, 4); else lookAt(p, x, z, 5); }
    return seen;
  }
  // V19: a honk. dir = { fx, fz, hw } (the honking car's heading and half width): people on the carriageway IN FRONT of the
  // car (within 26 m, inside a lane-wide corridor) get off the road — on a zebra they hurry across, anywhere else they
  // step aside to the nearer side of the car's path; everybody near looks at the car.
  function hornAt(pos, radius = 24, dir = null) {
    const x = pos.x ?? pos[0], z = pos.z ?? pos[2] ?? pos[1];
    const fx = dir ? dir.fx : 0, fz = dir ? dir.fz : 0, hw = dir ? (dir.hw || 0.95) : 0, R = Math.max(radius, dir ? 26 : 0);
    for (const p of people) {
      if (p.gone || p.car || UPRIGHT_BUSY[p.state]) continue; const d = hyp(p.x - x, p.z - z); if (d > R) continue;
      const onRoad = p.state === 'cross' || (city && city.onRoad(p.x, p.z));
      const lz = dir ? (p.x - x) * fx + (p.z - z) * fz : 0, lx = dir ? (p.x - x) * fz - (p.z - z) * fx : 0, ahead = dir && lz > 0.5 && Math.abs(lx) < hw + 2.6;
      if (d <= radius || ahead) lookAt(p, x, z, 1.8);
      if (onRoad && (ahead || (!dir && d < 14))) {
        p.hurry = time + 4; p.honked = time;
        if (p.state !== 'cross' && p.state !== 'dodge') {   // not on a zebra: off the car's path at once
          const sd = lx >= 0 ? 1 : -1, gap = hw + 2.2 - Math.abs(lx);
          p.tx = p.x + fz * sd * Math.max(1.2, gap) + fx * 0.4; p.tz = p.z - fx * sd * Math.max(1.2, gap) + fz * 0.4; p.fx = x; p.fz = z;
          setState(p, 'dodge'); p.until = time + 1.4; if (p.anchor) { p.anchor.p = null; p.anchor = null; }
          if (hash(p.id, 31) < 0.35) audio.shout(p.x, p.z, p.T.voice, 'hey');
        }
      } else if (d < 5 && hash(p.id, 12) < 0.3 && p.state === 'walk') { react(p, 'look', x, z, 1.2); p.pose = 'stand'; }
    }
    emit('people:horn', { x, z });
  }

  // ---- being hit -----------------------------------------------------------------------------------------------------------------------------------
  /** A car hit a person. car: any car object of the driving code (or { x, z, yaw, vx, vz }); impulse: optional { speed (m/s), dx, dz }.
   *  → { severity: 'light' | 'medium' | 'hard', speedKmh, slow } (slow = suggested speed loss of the car in m/s). */
  function onCarHit(car, p, impulse = null, byPlayer = true) {
    if (!p || p.gone || p.state === 'dead' || time - p.lastHit < 0.6) return null;
    if (spared(p)) { const cc = carState(car && car.ref ? car.ref : car, {}); if (cc) { const fx = Math.sin(cc.yaw), fz = Math.cos(cc.yaw); shove(p, cc, (p.x - cc.x) * -fz + (p.z - cc.z) * fx, fx, fz, cc.W / 2); } return null; }
    dropProp(p);
    const c = car && car.ref ? car : carState(car, {}) || { x: p.x, z: p.z, yaw: 0, vx: 0, vz: 0, speed: 0 };
    let sp = impulse?.speed ?? c.speed, dx = impulse?.dx ?? c.vx, dz = impulse?.dz ?? c.vz; const dl = hyp(dx, dz) || 1; dx /= dl; dz /= dl; if (!(sp > 0)) sp = 0.1;
    const kmh = sp * 3.6, frail = p.T.ageYears > 68 || p.T.ageYears < 11 ? 0.8 : 1, sev = p.state === 'down' ? (kmh > 12 ? 'hard' : 'light') : kmh < 22 * frail ? 'light' : kmh < 55 * frail ? 'medium' : 'hard';
    p.lastHit = time; stat.hits++; if (p.car) { leaveCar(p); } if (p.anchor) { p.anchor.p = null; p.anchor = null; } p.look = null;
    audio.thud(p.x, p.z, clamp(kmh / 90, 0.25, 1));
    if (sev === 'light') {
      p.sx = dx * Math.min(2.6, sp * 0.8); p.sz = dz * Math.min(2.6, sp * 0.8); setState(p, 'stumble'); p.until = time + 0.75; p.fx = c.x; p.fz = c.z; p.hp -= 0.08;
      setTimeout(() => { if (!p.gone) audio.shout(p.x, p.z, p.T.voice, 'hey'); }, 180);
    } else {
      const hard = sev === 'hard', k = hard ? 0.86 : 0.9, vmax = hard ? 19 : 14, v = Math.min(vmax, sp * k);
      // body frame: which way is the push relative to where the person faces
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), along = dx * fx + dz * fz, side = dx * -fz + dz * fx, spin = hard ? 3 + sp * 0.12 : 2.6 + rnd();
      p.rd = { x: p.x, y: p.K.J[0][1], z: p.z, vx: dx * v, vy: hard ? Math.min(5.4, 1.6 + sp * 0.17) : 1.3, vz: dz * v, wp: -along * spin + (rnd() - 0.5), wr: side * spin * 0.8 + (rnd() - 0.5), wy: (rnd() - 0.5) * (hard ? 5 : 1.5), rest: 0, e: 1, hard, slid: 0, lastDec: 0, air: 0 };
      if (Math.abs(p.rd.wp) + Math.abs(p.rd.wr) < 1.5) p.rd.wp = -spin;
      setState(p, 'rag'); p.hp -= hard ? 1 : 0.45;
      if (hard) { setTimeout(() => { if (!p.gone) audio.scream(p.x, p.z, p.T.voice); }, 30); addDecal(p.x, p.z, 0.9 + rnd() * 0.5, 3, 80); const S = drive.seat(c.ref || c); addCarDecal(c, (rnd() - 0.5) * 0.9, 0.62, (S.L || 4.8) / 2 + 0.012, 0.5, 'front'); addCarDecal(c, (rnd() - 0.5) * 0.8, Math.min(1.0, (S.H || 1.45) * 0.66), (S.L || 4.8) / 2 - 0.75, 0.6, 'up'); }
      else setTimeout(() => { if (!p.gone) audio.shout(p.x, p.z, p.T.voice, 'cry'); }, 60);
    }
    const n = alarm(p.x, p.z, sev === 'light' ? 0.25 : sev === 'medium' ? 0.7 : 1, sev === 'light' ? 10 : 28, p);
    if (n >= 3 && sev !== 'light') setTimeout(() => audio.gasp(p.x, p.z, n), 150);
    const out = { person: p, id: p.id, severity: sev, speedKmh: kmh, pos: { x: p.x, y: 0, z: p.z }, car: c.ref || car, byPlayer, witnesses: n, slow: sev === 'light' ? 0.3 : sev === 'medium' ? 1.2 : 2.2 };
    emit('people:hit', out); return out;
  }
  function ragStep(p, dt) {
    const r = p.rd, h = p.T.height * 0.44, rad = 0.13;
    r.vy -= 9.81 * dt; const ox = r.x, oz = r.z; r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    if (city && city.blocked && city.blocked(r.x + Math.sign(r.vx) * 0.25, r.z + Math.sign(r.vz) * 0.25)) {          // a wall: the body stops against it and drops
      const bx = city.blocked(r.x + Math.sign(r.vx) * 0.25, oz), bz = city.blocked(ox, r.z + Math.sign(r.vz) * 0.25); if (hyp(r.vx, r.vz) > 3) audio.thud(ox, oz, 0.5);
      if (bx || !bz) { r.vx *= -0.18; r.x = ox; } if (bz || !bx) { r.vz *= -0.18; r.z = oz; } r.wp *= 0.5; r.wr *= 0.5; } p.pitch += r.wp * dt; p.roll += r.wr * dt; p.yaw += r.wy * dt;
    const ct = Math.abs(Math.cos(p.pitch) * Math.cos(p.roll)), low = r.y - h * ct - rad;
    if (low < 0) {
      r.y -= low; if (r.vy < 0) { if (r.vy < -2.2) audio.thud(r.x, r.z, clamp(-r.vy / 9, 0.15, 0.6)); r.vy = -r.vy * 0.22; }
      const sp = hyp(r.vx, r.vz), fr = Math.exp(-(sp > 6 ? 1.6 : 3.4) * dt); r.vx *= fr; r.vz *= fr; r.slid += sp * dt;
      // on the ground gravity pulls the body to the nearest flat position (never on through a headstand); spin dies
      const viaP = Math.abs(Math.sin(p.pitch)) + (Math.abs(r.wp) > Math.abs(r.wr) ? 0.2 : 0) >= Math.abs(Math.sin(p.roll)) + (Math.abs(r.wr) > Math.abs(r.wp) ? 0.2 : 0);
      const a = viaP ? p.pitch : p.roll, w = viaP ? r.wp : r.wr, flat = Math.round((a - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2, up = Math.abs(Math.sin(a)) < 0.2;
      const acc = (up ? Math.sign(w || -1) : Math.sign(flat - a)) * 11 * Math.max(ct, 0.15) * dt, ad = Math.exp(-(r.hard ? 3 : 4.5) * dt);
      if (viaP) { r.wp = (r.wp + acc) * ad; r.wr *= Math.exp(-8 * dt); p.roll += (Math.round(p.roll / Math.PI) * Math.PI - p.roll) * (1 - Math.exp(-5 * dt)); }
      else { r.wr = (r.wr + acc) * ad; r.wp *= Math.exp(-8 * dt); p.pitch += (Math.round(p.pitch / Math.PI) * Math.PI - p.pitch) * (1 - Math.exp(-5 * dt)); }
      r.wy *= Math.exp(-5 * dt); const wm = r.hard ? 12 : 6; r.wp = clamp(r.wp, -wm, wm); r.wr = clamp(r.wr, -wm, wm);
      if (gore && r.hard && sp > 1.5 && r.slid - r.lastDec > 1.1) { r.lastDec = r.slid; addDecal(r.x, r.z, 0.6 + rnd() * 0.5, 1, 70).rot = Math.atan2(r.vx, r.vz) + Math.PI / 2; }
      if (sp < 0.6 && ct < 0.3 && Math.abs(r.vy) < 0.6 && Math.abs(r.wp) + Math.abs(r.wr) < 1.6) r.rest += dt; else r.rest = 0;
    } else r.air += dt;
    r.e = clamp(hyp(r.vx, r.vz, r.vy) / 6 + (Math.abs(r.wp) + Math.abs(r.wr)) / 10, 0, 1);
    p.x = r.x; p.z = r.z;
    if (r.rest > 0.35 || p.st > 9) {
      // settle flat: on the back, on the front or on a side — whichever is nearest
      const snap = a => Math.round((a - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2; const viaPitch = Math.abs(Math.sin(p.pitch)) >= Math.abs(Math.sin(p.roll));
      p.restPitch = viaPitch ? snap(p.pitch) : Math.round(p.pitch / Math.PI) * Math.PI; p.restRoll = viaPitch ? Math.round(p.roll / Math.PI) * Math.PI : snap(p.roll); p.face = viaPitch ? (Math.sin(p.restPitch) > 0 ? 'lieFront' : 'lieBack') : 'lieBack';
      r.vx = r.vz = r.vy = 0;
      if (p.hp <= 0) { setState(p, 'dead'); p.deadAt = time; if (gore) p.pool = addDecal(p.x, p.z, 0.7, 0, B.bodyTime + 40, 1.3); emit('people:down', { person: p, id: p.id, dead: true, pos: { x: p.x, y: 0, z: p.z } }); }
      else { setState(p, 'down'); p.until = time + 3 + rnd() * 3.5; if (gore) addDecal(p.x, p.z, 0.35, 2, 60); emit('people:down', { person: p, id: p.id, dead: false, pos: { x: p.x, y: 0, z: p.z } }); }
    }
  }

  // ---- occupants of traffic cars, pulling a driver out ---------------------------------------------------------------------------------------------------
  const carPose = (car, out) => carState(car, out);
  /** Put a driver (and sometimes a passenger) into a traffic car. The car object gets `driver` / `passenger` (persons). */
  function attachOccupants(car, { passenger = null, seed = null } = {}) {
    if (!car || car.driver || car.noOccupants || car.owner === 'player' || car.parked) return car && car.driver;
    const S = drive.seat(car), c = carPose(car, {}), mk = (side, role) => { const T = makeTraits(seed != null ? seed + (side > 0 ? 0 : 1) : newSeed(), { age: 19 + rnd() * 55 }); T.acc.bag = null; const p = addPerson(T, c.x, c.z, c.yaw, 'seat'); p.vr = variantsOf(T); p.car = car; p.seat = { x: side * S.x, y: S.y, z: S.z, door: S.door, side, driver: role === 'driver' }; p.pose = role === 'driver' ? 'drive' : 'sit'; return p; };
    car.driver = mk(1, 'driver'); car.hadDriver = true; if (passenger ?? rnd() < 0.28) car.passenger = mk(-1, 'passenger');
    return car.driver;
  }
  function seatWorld(p, c, out, extra = 0) { const s = p.seat, lx = s.x + s.side * extra, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw); out[0] = c.x + cs * lx + sn * s.z; out[1] = c.z - sn * lx + cs * s.z; return out; }
  function leaveCar(p) { const car = p.car; if (!car) return; if (car.driver === p) car.driver = null; if (car.passenger === p) car.passenger = null; p.car = null; p.y = 0; }
  const cs1 = {}, cs2 = {};
  function canPullOut(car, who = null) {
    const d = car && car.driver; if (!d || d.gone || d.state !== 'seat') return false;
    const c = carPose(car, cs1); if (c.speed > 2.2) return false;
    if (who) { seatWorld(d, c, tmpPt, 1.0); if (hyp((who.x ?? who[0]) - tmpPt[0], (who.z ?? who[2] ?? who[1]) - tmpPt[1]) > 2.6) return false; }
    return true;
  }
  /** Pull the driver out. → { person, done: Promise<car> } — `done` resolves when the seat is free (≈ 1.1 s): then call takeTrafficCar(car). */
  function pullOutDriver(car, who = null) {
    if (!canPullOut(car, null)) return null;
    const d = car.driver; let res; const done = new Promise(r => { res = r; });
    setState(d, 'pulled'); d.pullRes = res; d.thief = who; drive.openDoor(car, true);
    emit('people:pullout', { phase: 'start', car, person: d });
    return { person: d, done };
  }
  function pulledStep(p, dt) {
    const car = p.car, t = p.st;
    if (car) {
      const c = carPose(car, cs2), k = clamp((t - 0.3) / 0.75), e = k * k * (3 - 2 * k); seatWorld(p, c, tmpPt, e * (p.seat.door - Math.abs(p.seat.x) + 0.75));
      p.x = tmpPt[0]; p.z = tmpPt[1]; p.y = lerp(p.seatY, 0, e); p.yaw = c.yaw + p.seat.side * e * 1.2; p.pose = e > 0.5 ? 'stumble' : 'drive'; p.mix = e;
      if (t >= 1.1) {
        const pass = car.passenger; leaveCar(p); p.y = 0; if (p.pullRes) { p.pullRes(car); p.pullRes = null; }
        emit('people:pullout', { phase: 'out', car, person: p }); emit('people:carjack', { car, person: p, pos: { x: p.x, y: 0, z: p.z } });
        if (pass && !pass.gone) { const cc = carPose(car, {}); leaveCar(pass); seatWorld(pass, cc, tmpPt, pass.seat.door - Math.abs(pass.seat.x) + 0.8); pass.x = tmpPt[0]; pass.z = tmpPt[1]; pass.y = 0; pass.pose = 'stand'; setState(pass, 'idle'); react(pass, 'flee', cc.x, cc.z, 9); audio.scream(pass.x, pass.z, pass.T.voice); }
        // what the driver does next
        const u = p.T.temper, cx = c.x, cz = c.z; p.fx = cx; p.fz = cz; p.jackCar = car;
        if (u < 0.3) { p.sx = Math.cos(c.yaw) * 1.6; p.sz = -Math.sin(c.yaw) * 1.6; setState(p, 'stumble'); p.until = time + 0.8; p.after = 'flee'; audio.scream(p.x, p.z, p.T.voice); }
        else if (u < 0.55) { p.sx = Math.cos(c.yaw) * 1.2; p.sz = -Math.sin(c.yaw) * 1.2; setState(p, 'stumble'); p.until = time + 0.7; p.after = 'call'; audio.shout(p.x, p.z, p.T.voice, 'hey'); }
        else if (u < 0.82) { p.sx = Math.cos(c.yaw) * 0.9; p.sz = -Math.sin(c.yaw) * 0.9; setState(p, 'stumble'); p.until = time + 0.6; p.after = 'fight'; audio.shout(p.x, p.z, p.T.voice, 'hey'); }
        else { p.sx = Math.cos(c.yaw) * 2.2; p.sz = -Math.sin(c.yaw) * 2.2; setState(p, 'stumble'); p.until = time + 0.5; p.after = 'fall'; audio.shout(p.x, p.z, p.T.voice, 'cry'); }
        alarm(p.x, p.z, 0.45, 18, p);
      }
    }
  }

  // ---- actors (police officers and anything else another module wants to direct) --------------------------------------------------------------------
  /** A person another module controls: → { person, goto(x, z, speed), face(x, z), pose(name), arrived, remove() }. */
  function makeActor({ role = 'police', seed = null, x = 0, z = 0, yaw = 0, gender, age } = {}) {
    const p = addPerson(makeTraits(seed ?? newSeed(), { role, gender, age }), x, z, yaw, 'actor'); p.pose = 'stand'; p.tx = x; p.tz = z; p.want = 0; p.keep = true;
    return { person: p, get arrived() { return hyp(p.tx - p.x, p.tz - p.z) < 0.35; }, goto(nx, nz, speed = 1.6) { p.tx = nx; p.tz = nz; p.want = speed; }, face(fx, fz) { p.faceTo = [fx, fz]; }, pose(n) { p.pose = n; }, remove() { removePerson(p); } };
  }

  // ---- simulation step ----------------------------------------------------------------------------------------------------------------------------------
  const grid = new Map(), gkey = (x, z) => (Math.floor(x / 2) * 73856093) ^ (Math.floor(z / 2) * 19349663);
  function crossingClear(p) { const e = city.edges[p.route.e], A = city.nodes[e.a], Z = city.nodes[e.b], mx = (A.x + Z.x) / 2, mz = (A.z + Z.z) / 2; for (const c of cars) { if (c.speed < 1.5) continue; const dx = mx - c.x, dz = mz - c.z, d = hyp(dx, dz); if (d > 12 + c.speed * 2.5) continue; if ((dx * c.vx + dz * c.vz) / (d * c.speed + 1e-6) > 0.6) return false; } return true; }
  function simulate(p, dt) {
    p.st += dt;
    const s = p.state;
    if (s === 'seat') { const car = p.car; if (!car || car.taken === true && car.driver !== p && car.passenger !== p) { removePerson(p); return; } const c = carPose(car, cs1); seatWorld(p, c, tmpPt); p.x = tmpPt[0]; p.z = tmpPt[1]; p.yaw = c.yaw; p.seatY = p.seat.y - (p.K.J[0][1] - p.K.legU * (p.pose === 'drive' ? 0.82 : 0.96)) + c.y; p.y = p.seatY; p.speed = 0; return; }
    if (s === 'pulled') { pulledStep(p, dt); return; }
    if (s === 'rag') { ragStep(p, dt); return; }
    if (s === 'dead') { if (p.pool && p.pool.size < 1.7) p.pool.size += 0.3 * dt; return; }
    if (s === 'down') { if (time > p.until) { setState(p, 'getup'); p.until = time + 2.1; } return; }
    if (s === 'getup') { const k = clamp(p.st / 2.1); p.pitch = lerp(p.restPitch, Math.round(p.restPitch / TAU) * TAU, k * k * (3 - 2 * k)); p.roll = lerp(p.restRoll, Math.round(p.restRoll / TAU) * TAU, k * k * (3 - 2 * k)); if (k >= 1) { p.pitch = p.roll = 0; p.rd = null; p.limp = 1; p.calm = time + 30; audio.shout(p.x, p.z, p.T.voice, 'cry'); if (city) { rejoin(p); if (!p.gone) { p.fx = p.fx ?? p.x; react(p, 'flee', p.fx, p.fz ?? p.z, 7); p.want = 1.3; } } else setState(p, 'idle'); } return; }
    if (s === 'stumble') { p.x += (p.sx || 0) * dt; p.z += (p.sz || 0) * dt; const f = Math.exp(-3 * dt); p.sx *= f; p.sz *= f; p.speed = 0;
      if (time > p.until) { const a = p.after; p.after = null; if (a === 'flee') { setState(p, 'idle'); react(p, 'flee', p.fx, p.fz, 9); } else if (a === 'call') { setState(p, 'angry'); p.until = time + 2.2; p.then = 'call'; } else if (a === 'fight') { setState(p, 'fight'); p.until = time + 9; p.want = 3.2; } else if (a === 'fall') { p.rd = { x: p.x, y: p.K.J[0][1], z: p.z, vx: p.sx * 0.8, vy: 0.6, vz: p.sz * 0.8, wp: -2.6, wr: (rnd() - 0.5) * 2, wy: 0, rest: 0, e: 1, hard: false, slid: 0, lastDec: 0, air: 0 }; p.hp = Math.max(p.hp, 0.5); setState(p, 'rag'); } else { setState(p, 'angry'); p.until = time + 2.6; } }
      return; }
    if (s === 'angry') { p.yaw += clamp(angDiff(Math.atan2(p.fx - p.x, p.fz - p.z), p.yaw), -6 * dt, 6 * dt); p.speed = 0; p.pose = 'angry'; if (p.st > 0.9 && !p.shouted) { p.shouted = true; audio.shout(p.x, p.z, p.T.voice, 'angry'); }
      if (time > p.until) { p.shouted = false; if (p.then === 'call') { p.then = null; setState(p, 'call'); p.until = time + 4.5; p.pose = 'phone'; } else if (city) rejoin(p); else setState(p, 'idle'); } return; }
    if (s === 'call') { p.speed = 0; p.pose = 'phone'; if (time > p.until) { emit('people:call-police', { person: p, pos: { x: p.x, y: 0, z: p.z }, car: p.jackCar || null }); if (city) rejoin(p); else setState(p, 'idle'); } return; }
    if (s === 'fight') {
      // run back to the driver's door and try to drag the thief out again
      const car = p.jackCar, c = car ? carPose(car, cs1) : null; if (!c || time > p.until) { setState(p, 'angry'); p.until = time + 2; p.then = 'call'; return; }
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), lx = (p.seat?.door ?? 0.95) + 0.45, lz = p.seat?.z ?? 0, tx = c.x + cs * lx + sn * lz, tz = c.z - sn * lx + cs * lz, d = hyp(tx - p.x, tz - p.z);
      if (c.speed > 3.2 || d > 14) { setState(p, 'angry'); p.until = time + 2.4; p.then = rnd() < 0.7 ? 'call' : null; p.fx = c.x; p.fz = c.z; return; }
      if (d > 0.45) { steer(p, tx, tz, p.want, dt, 8); p.pullT = 0; p.pose = 'stand'; }
      else { p.speed = 0; p.yaw += clamp(angDiff(c.yaw - Math.PI / 2, p.yaw), -8 * dt, 8 * dt); p.pose = 'pull'; if (!p.pullT) { p.pullT = 0.001; emit('people:pullback', { phase: 'start', car, person: p }); audio.shout(p.x, p.z, p.T.voice, 'angry'); }
        p.pullT += dt; if (p.pullT > 3.4) { emit('people:pullback', { phase: 'done', car, person: p }); p.pullT = 0; setState(p, 'angry'); p.until = time + 2; p.then = null; p.fx = c.x; p.fz = c.z; } }
      return; }
    if (s === 'anchor') { p.speed = 0; if (p.anchor && p.anchor.waiter) { const a = p.anchor, ph = (time * 0.05 + hash(p.id, 2)) % 1, nx = a.poi.nx || 0, nz = a.poi.nz || 1, tx = a.x + nz * Math.sin(ph * TAU) * 2.4, tz = a.z - nx * Math.sin(ph * TAU) * 2.4; if (hyp(tx - p.x, tz - p.z) > 0.25) steer(p, tx, tz, 0.9, dt); } return; }
    if (s === 'actor') { const d = hyp(p.tx - p.x, p.tz - p.z); if (d > 0.3 && p.want > 0) steer(p, p.tx, p.tz, p.want, dt, 8); else { p.speed = 0; if (p.faceTo) p.yaw += clamp(angDiff(Math.atan2(p.faceTo[0] - p.x, p.faceTo[1] - p.z), p.yaw), -6 * dt, 6 * dt); } return; }
    if (s === 'idle' || s === 'look' || s === 'film' || s === 'shout' || s === 'cower') {
      p.speed = 0; if (p.yaw0 != null && s !== 'idle') p.yaw += clamp(angDiff(p.yaw0, p.yaw), -5 * dt, 5 * dt);
      if (s === 'shout' && p.st > 0.3 && !p.shouted) { p.shouted = true; audio.shout(p.x, p.z, p.T.voice, 'hey'); }
      if (time > p.until) { p.shouted = false; p.yaw0 = null; if (p.anchor) { setState(p, 'anchor'); p.pose = p.anchor.pose; } else if (p.route) setState(p, city.edges[p.route.e].kind === 'cross' ? 'cross' : 'walk'); else if (city) rejoin(p); }
      return; }
    if (s === 'flee') {
      const dx = p.x - p.fx, dz = p.z - p.fz, d = hyp(dx, dz) || 1; let tx = p.x + dx / d * 6, tz = p.z + dz / d * 6;
      if (city && city.blocked && city.blocked(tx, tz)) { tx = p.x - dz / d * 6 * (hash(p.id, 4) < 0.5 ? 1 : -1); tz = p.z + dx / d * 6 * (hash(p.id, 4) < 0.5 ? 1 : -1); }
      steer(p, tx, tz, p.want, dt, 7); if (time > p.until || d > 60) { if (city) rejoin(p); else setState(p, 'idle'); } return; }
    if (s === 'dodge') { steer(p, p.tx, p.tz, p.T.ageYears > 65 ? 2.2 : 3.6, dt, 12); if (time > p.until) { lookAt(p, p.fx, p.fz, 1.5); if (p.route) setState(p, city.edges[p.route.e].kind === 'cross' ? 'cross' : 'walk'); else rejoin(p); } return; }
    if (s === 'enter') { const d = steer(p, p.tx, p.tz, p.want, dt); if (d < 0.4) { stat.entered++; removePerson(p); } else if (p.st > 20) rejoin(p); return; }
    if (s === 'exit') { const d = steer(p, p.tx, p.tz, p.want, dt); if (d < 0.5) { const ne = p.exitEdge, e = city.edges[ne.edge]; startRoute(p, ne.edge, rnd() < 0.5 ? 1 : -1); p.route.s = p.route.dir > 0 ? ne.t * e.len : (1 - ne.t) * e.len; setState(p, 'walk'); } return; }
    if (!p.route) { p.speed = 0; return; }
    if (s === 'wait') {
      p.speed += clamp(-p.speed, -5 * dt, 0); const e = city.edges[p.route.e], [A, Z] = ends(e, p.route.dir); p.yaw += clamp(angDiff(Math.atan2(Z.x - A.x, Z.z - A.z), p.yaw), -3 * dt, 3 * dt);
      if (time > p.until) { const sig = city.hasSignal(e), go = sig ? city.canWalk(e, city.time()) : (crossingClear(p) || p.st > 7);
        if (go || (sig && p.T.jay && p.st > 2 + hash(p.id, 8) * 4 && crossingClear(p))) { setState(p, 'cross'); p.jay = sig && !go; } else p.until = time + 0.25; }
      return; }
    // walk / cross / jog
    if (p.buddy) { const A = p.buddy; if (A.gone || UPRIGHT_BUSY[A.state]) { p.buddy = null; if (!A.gone) { react(p, 'cower', A.x, A.z, 8); return; } }
      else if (A.state === 'flee') { p.buddy = A; steer(p, A.x, A.z, A.speed * 1.05 + 0.4, dt, 7); return; }
      else { const tx = A.x + Math.cos(A.yaw) * 0.52 * p.side + Math.sin(A.yaw) * 0.1, tz = A.z - Math.sin(A.yaw) * 0.52 * p.side + Math.cos(A.yaw) * 0.1, d = hyp(tx - p.x, tz - p.z); p.route = A.route; if (A.speed < 0.1 && d < 0.25) { p.speed = 0; p.yaw += clamp(angDiff(A.yaw, p.yaw), -3 * dt, 3 * dt); p.pose = 'stand'; } else steer(p, tx + Math.sin(A.yaw) * 0.6, tz + Math.cos(A.yaw) * 0.6, Math.min(2.4, A.speed + clamp(d - 0.2, -0.3, 0.8) * 1.5), dt, 6); p.state = A.state === 'cross' || A.state === 'wait' ? A.state : 'walk'; return; } }
    let v = p.want * (s === 'cross' ? 1.15 : 1) * (p.hurry > time ? 1.7 : 1) * (p.limp ? 0.6 : 1);
    if (p.d2 < B.simR * B.simR) {            // keep out of each other's way (only near the camera)
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw); let block = 0;
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { const l = grid.get(gkey(p.x + gx * 2, p.z + gz * 2)); if (!l) continue; for (const q of l) { if (q === p) continue; const dx = q.x - p.x, dz = q.z - p.z, ah = dx * fx + dz * fz; if (ah < 0.05 || ah > 1.7) continue; const sd = dx * -fz + dz * fx; if (Math.abs(sd) > 0.62) continue;
        const e = city.edges[p.route.e], half = Math.max(0.15, e.w / 2 - 0.3); p.route.latT = clampLat(e, p.route.dir, clamp(p.route.lat + (sd > 0 ? -0.7 : 0.7), -half, half)); if (ah < 0.75) block = Math.max(block, MOVING[q.state] && Math.cos(q.yaw - p.yaw) > 0.5 ? 0.5 : 0.85); } }
      v *= 1 - block;
    }
    followRoute(p, dt, v);
  }

  // cars against people: get out of the way, or get hit
  function carsVsPeople(dt) {
    for (const c of cars) {
      if (c.speed < 1.2) continue; const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), hw = c.W / 2, hl = c.L / 2, reach = c.speed * 1.5 + 6;
      for (const p of people) {
        if (p.gone || p.car === c.ref || p.state === 'seat' || p.state === 'pulled' || p.state === 'rag') continue;
        const dx = p.x - c.x, dz = p.z - c.z; if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
        const lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx;          // car frame: lz ahead, lx to the car's right
        const mv = c.vx * fx + c.vz * fz >= 0 ? 1 : -1, az = lz * mv;
        if (Math.abs(lx) < hw + 0.22 && lz > -hl - 0.2 && lz < hl + 0.25) { if (p.state === 'dead') { if (time - p.lastHit > 1.5 && c.speed > 4) { p.lastHit = time; audio.thud(p.x, p.z, 0.4); if (c.player) emit('people:hit', { person: p, id: p.id, severity: 'body', speedKmh: c.speed * 3.6, pos: { x: p.x, y: 0, z: p.z }, car: c.ref, byPlayer: true, witnesses: 0, slow: 0.8 }); } continue; }
          if (c.player && spared(p)) { if (!UPRIGHT_BUSY[p.state]) { shove(p, c, lx, fx, fz, hw); if (time - (p.missT || -9) > 2) { p.missT = time; audio.scream(p.x, p.z, p.T.voice); alarm(p.x, p.z, 0.3, 12, p); emit('people:near-miss', { person: p, pos: { x: p.x, y: 0, z: p.z } }); } } }
          else if (c.player) { if (opts.autoHit !== false) { const r = onCarHit(c, p, null, true); if (r && opts.autoSlow !== false) drive.impulse(c.ref, -Math.sin(c.yaw) * r.slow * mv, -Math.cos(c.yaw) * r.slow * mv); } }
          else if (!UPRIGHT_BUSY[p.state]) { const sd = lx >= 0 ? 1 : -1; p.x += -fz * sd * (hw + 0.35 - Math.abs(lx)); p.z += fx * sd * (hw + 0.35 - Math.abs(lx)); p.fx = c.x; p.fz = c.z; if (p.state !== 'dodge' && p.state !== 'anchor') { p.tx = p.x + -fz * sd * 1.2; p.tz = p.z + fx * sd * 1.2; setState(p, 'dodge'); p.until = time + 0.5; } }   // traffic never injures anybody: the person is nudged aside
          continue; }
        if (UPRIGHT_BUSY[p.state] || p.state === 'dodge' || p.state === 'anchor' && p.pose === 'sit') continue;
        if (az > 0 && az < c.speed * 1.35 + 3 && Math.abs(lx) < hw + 0.85 && c.speed > 2.5 && !p.noDodge) {
          if (!p.dodgeAt) p.dodgeAt = time + 0.22 + hash(p.id, 21) * 0.33 + (p.T.ageYears > 65 ? 0.25 : 0) + (p.pose === 'phone' ? 0.25 : 0);
          else if (time >= p.dodgeAt) { const sd = lx >= 0 ? 1 : -1; p.tx = p.x + -fz * sd * 2.4 + fx * 0.3; p.tz = p.z + fx * sd * 2.4 + fz * 0.3; p.fx = c.x; p.fz = c.z; setState(p, 'dodge'); p.until = time + 0.7; p.dodgeAt = 0; if (hash(p.id, frame) < 0.4) audio.shout(p.x, p.z, p.T.voice, 'hey'); if (p.anchor) { p.anchor.p = null; p.anchor = null; } }
        } else { if (p.dodgeAt && time > p.dodgeAt + 1) p.dodgeAt = 0; if (c.speed > 13 && Math.abs(lx) < hw + 3 && az > -2 && az < 14 && !p.look) lookAt(p, c.x, c.z, 1.4); }
      }
    }
  }

  // ---- drawing: tiers, poses, instance buffers -----------------------------------------------------------------------------------------------------------
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), EU = new THREE.Euler(0, 0, 0, 'YXZ'), V3 = new THREE.Vector3(), SC = new THREE.Vector3(), tgt = newPose(), order = [];
  const LIE = { lieBack: poseStatic(newPose(), 'lieBack'), lieFront: poseStatic(newPose(), 'lieFront') };
  function nearPose(p, dt) {
    const s = p.state, K = p.K, P = tgt;
    if (s === 'rag') { const r = p.rd, e = 0.35 + 0.65 * r.e, w = time * 13 + p.id; P.fill(0); P[9] = 0.9 * e * Math.sin(w) + 0.6; P[13] = 0.9 * e * Math.sin(w * 1.13 + 2) + 0.4; P[10] = 0.5 + 0.5 * e; P[14] = 0.5 + 0.5 * e * Math.cos(w * 0.7); P[11] = 0.6 + 0.5 * Math.sin(w * 0.9 + 1); P[15] = 0.6 + 0.5 * Math.sin(w * 1.2); P[17] = 0.7 * e * Math.sin(w * 0.8 + 1); P[21] = 0.7 * e * Math.sin(w * 0.93 + 3); P[19] = 0.5 + 0.5 * Math.sin(w * 1.1 + 2); P[23] = 0.5 + 0.5 * Math.sin(w * 0.85); P[18] = 0.2 * e; P[22] = 0.25 * e; P[7] = 0.5 * Math.sin(w * 0.6); P[4] = 0.3 * Math.sin(w * 0.5); }
    else if (s === 'down' || s === 'dead') P.set(LIE[p.face] || LIE.lieBack);
    else if (s === 'getup') { const k = clamp(p.st / 2.1); poseStatic(P, k < 0.75 ? 'kneel' : 'stand', K); if (k < 0.3) { const a = LIE[p.face] || LIE.lieBack, u = k / 0.3; for (let i = 0; i < POSE_N; i++) P[i] = lerp(a[i], P[i], u); } }
    else if (s === 'stumble') poseStatic(P, 'stumble', K);
    else if (s === 'pulled') poseStatic(P, p.mix > 0.5 ? 'stumble' : 'drive', K);
    else if (s === 'seat') { poseStatic(P, p.pose, K); P[7] = p.seat.driver ? 0.08 * Math.sin(time * 0.5 + p.id) : 0.25 * Math.sin(time * 0.3 + p.id); if (p.seat.driver) { P[9] += 0.05 * Math.sin(time * 1.3 + p.id); P[13] -= 0.05 * Math.sin(time * 1.3 + p.id); } }
    else if (p.ride) { poseStatic(P, p.pose, K); if (p.prop === 'bike') { const w = Math.sin(p.phase); P[17] = 0.62 + 0.3 * w; P[19] = 1.1 + 0.5 * w; P[21] = 0.62 - 0.3 * w; P[23] = 1.1 - 0.5 * w; P[1] = 0.42; P[4] = 0.2; P[8] = -0.35; P[9] = 0.42; P[13] = 0.42; P[11] = 0.3; P[15] = 0.3; P[12] = 0; P[16] = 0; } else { P[11] = 0.55; P[15] = 0.55; P[9] = 0.42; P[13] = 0.42; P[17] = 0.1; P[21] = -0.08; P[19] = 0.12; } }
    else if (p.speed > 0.12) { poseWalk(P, p.phase, p.amp, K, { stoop: p.T.stoop }); if (p.prop === 'pram') { const q = poseStatic(newPose(), 'push', K); for (let i = 9; i < 17; i++) P[i] = q[i]; } if (p.prop === 'cane') { P[13] = 0.25 + 0.2 * Math.sin(p.phase); P[15] = 0.35; } if (p.prop === 'dog') { const o = p.dog.side > 0 ? 9 : 13; P[o] = 0.3; P[o + 2] = 0.5; } if (p.limp) { P[21] *= 0.45; P[23] *= 0.4; P[2] += 0.09 * Math.sin(p.phase); P[1] += 0.08; } if (s === 'flee') { P[10] += 0.25; P[14] += 0.25; } if (p.T.acc.bag === 'hand') { P[13] *= 0.3; P[15] = 0.15; } if (s === 'actor' && p.pose !== 'stand') { const q = poseStatic(newPose(), p.pose, K); for (let i = 9; i < 17; i++) P[i] = q[i]; } }
    else { poseStatic(P, p.pose, K); const w = time + p.id * 1.7; P[4] += 0.012 * Math.sin(w * 1.3); P[2] += 0.012 * Math.sin(w * 0.37); if (p.pose === 'talk') { P[13] += 0.14 * Math.sin(w * 2.7); P[15] += 0.2 * Math.sin(w * 3.1); P[7] += 0.12 * Math.sin(w * 0.9); P[8] += 0.05 * Math.sin(w * 1.7); } else if (p.pose === 'angry') { P[13] += 0.28 * Math.sin(time * 9); P[15] += 0.25 * Math.sin(time * 9 + 1); } else if (p.pose === 'shout') { P[9] += 0.12 * Math.sin(time * 7); P[13] += 0.12 * Math.sin(time * 7 + 2); } else if (p.pose === 'pull') { P[1] += 0.12 * Math.sin(time * 6); P[9] += 0.2 * Math.sin(time * 6); P[13] += 0.2 * Math.sin(time * 6); } else if (p.pose === 'stand') { P[7] += 0.18 * Math.sin(w * 0.23); } }
    if (p.look && time < p.lookT && s !== 'rag' && s !== 'down' && s !== 'dead') { const a = clamp(angDiff(Math.atan2(p.look[0] - p.x, p.look[1] - p.z), p.yaw), -1.25, 1.25); P[7] = a; P[5] += a * 0.25; } else if (p.look && time >= p.lookT) p.look = null;
    const k = s === 'rag' ? 1 : 1 - Math.exp(-dt * (p.speed > 0.12 ? 22 : 9)), C = p.P; for (let i = 0; i < POSE_N; i++) C[i] += (P[i] - C[i]) * k;
  }
  const seatedDrop = p => (p.pose === 'sit' || p.pose === 'drive') && p.speed < 0.12 && (p.state === 'anchor' || p.state === 'seat' || p.state === 'pulled');
  function draw(dt, camera) {
    // choose tiers
    order.length = 0; let nearN = 0;
    for (const p of people) { if (p.gone) continue; const dx = p.x - cam.x, dz = p.z - cam.z, dy = cam.y - 1; p.d2 = dx * dx + dz * dz + dy * dy; p.vis = p.d2 < 3 || inView(p.x, p.z, 1.4); order.push(p); }
    order.sort((a, b) => a.d2 - b.d2);
    let mi = 0, fi = 0, si = 0, built = 0; const nr2 = B.nearR * B.nearR, mr2 = B.midR * B.midR, dayShadow = light !== 'night';
    for (const p of order) {
      const lying = p.state === 'rag' || p.state === 'down' || p.state === 'dead' || p.state === 'getup';
      let tier = 2; if (p.vis) { if (p.d2 < (p.fig ? nr2 * 1.25 : nr2) * (lying ? 4 : 1) && nearN < B.near) tier = 0; else if (p.d2 < mr2 && mi < B.mid) tier = 1; }
      if (tier === 0 && !p.fig) { if (built < 1 || warmFigs) { p.fig = makeFigure(p.T, { faceSize: B.faceSize }); p.fig.mesh.matrixAutoUpdate = false; root.add(p.fig.mesh); built++; stat.built++; p.P.set(nearPoseInit(p)); } else tier = 1; }
      if (tier !== 0 && p.fig && (p.d2 > nr2 * 2.2 || !p.vis && p.d2 > nr2 * 0.6 || figCount() > B.near + 8)) { p.fig.dispose(); p.fig = null; }
      p.tier = tier;
      const moving = p.speed > 0.12;
      if (moving) { const stride = 4 * p.K.legLen * Math.sin(0.46 * Math.min(1.25, p.amp || 1)); p.amp = clamp(p.speed / (p.limp ? 0.9 : 1.32) * (1.75 / p.T.height) ** 0.5, 0.35, 1.75); p.phase = (p.phase + TAU * p.speed * dt / Math.max(0.5, stride * (p.amp > 1.1 ? 1.5 : 1))) % TAU; } else p.amp = 0;
      const drop = seatedDrop(p);
      if (tier === 0) {
        nearN++; nearPose(p, dt); const f = p.fig; f.pose.set(p.P); f.apply(); f.mesh.visible = true;
        if (lying && p.rd) { EU.set(p.pitch, p.yaw, p.roll); Q.setFromEuler(EU); const hy = p.state === 'rag' ? p.rd.y : lerp(0.14, p.K.J[0][1], p.state === 'getup' ? clamp(p.st / 2.1) ** 2 : 0); V3.set(0, -p.K.J[0][1], 0).applyQuaternion(Q); V3.x += p.x; V3.y += hy; V3.z += p.z; }
        else { EU.set(0, p.yaw, 0); Q.setFromEuler(EU); V3.set(p.x, p.y + (drop ? 0 : 0), p.z); if (drop) { /* hips already lowered by the pose */ } }
        f.mesh.matrix.compose(V3, Q, SC.set(1, 1, 1)); f.mesh.matrixWorldNeedsUpdate = true;
      } else {
        if (p.fig) p.fig.mesh.visible = false;
        const Tn = tier === 1 ? mid : far, i = tier === 1 ? mi++ : fi++; if (i >= Tn.cap) continue;
        let pid = lying ? POSE_ID.lie : moving && !p.ride ? 0 : (POSE_ID[p.pose] ?? 0), y = p.y;
        if (lying) { EU.set(p.rd ? (p.state === 'rag' ? p.pitch : p.restPitch ?? p.pitch) : -Math.PI / 2, p.yaw, p.rd ? p.roll : 0); Q.setFromEuler(EU); const hy = p.state === 'rag' && p.rd ? p.rd.y : 0.14; V3.set(0, -p.K.J[0][1], 0).applyQuaternion(Q); V3.x += p.x; V3.y += hy; V3.z += p.z; }
        else { EU.set(0, p.yaw, 0); Q.setFromEuler(EU); V3.set(p.x, y, p.z); }
        M4.compose(V3, Q, SC.set(p.sxz, p.sy, p.sxz)); Tn.mesh.setMatrixAt(i, M4);
        const o = i * 4; Tn.iA.array[o] = pid >= 6 ? time * 2 + p.id : p.phase; Tn.iA.array[o + 1] = p.amp; Tn.iA.array[o + 2] = pid; Tn.iA.array[o + 3] = p.row; Tn.iV.array[o] = p.vr[0]; Tn.iV.array[o + 1] = p.vr[1]; Tn.iV.array[o + 2] = p.vr[2]; Tn.iV.array[o + 3] = p.vr[3];
      }
      if (dayShadow && p.state !== 'seat' && p.d2 < 70 * 70 && si < CAP) { const w = lying ? 1.4 : 0.62; M4.makeScale(w * p.sxz, 1, w * p.sxz); M4.setPosition(p.x, 0.015, p.z); shadows.setMatrixAt(si++, M4); }
    }
    mid.mesh.count = mi; far.mesh.count = fi; shadows.count = si;
    // things carried / ridden
    props.begin();
    for (const p of order) { const k = p.prop; if (!k || p.d2 > 85 * 85 || !p.vis || p.state === 'seat') continue; const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), lx = Math.cos(p.yaw), lz = -Math.sin(p.yaw), sc = p.T.height / 1.75;
      if (k === 'cane') props.put(k, p.x - lx * 0.27 + fx * 0.16, 0, p.z - lz * 0.27 + fz * 0.16, p.yaw, sc, 0xffffff, 0, p.speed > 0.1 ? 0.14 * Math.sin(p.phase) : 0);
      else if (k === 'pram') props.put(k, p.x + fx * 0.74, 0, p.z + fz * 0.74, p.yaw, 1, p.col);
      else if (k === 'bike' || k === 'scooter') props.put(k, p.x + fx * (k === 'bike' ? 0.22 : 0.1), 0, p.z + fz * (k === 'bike' ? 0.22 : 0.1), p.yaw, k === 'bike' ? clamp(sc, 0.9, 1.08) : 1, p.col);
      else if (k === 'dog') { const D = p.dog, w = time * 0.6 + p.id, ah = 0.8 + 0.22 * Math.sin(w * 1.3), sd = D.side * (0.5 + 0.14 * Math.sin(w * 0.8)), tx = p.x + fx * ah + lx * sd, tz = p.z + fz * ah + lz * sd;
        if (p.dogX == null || hyp(p.dogX - tx, p.dogZ - tz) > 3) { p.dogX = tx; p.dogZ = tz; p.dogYaw = p.yaw; } const ddx = tx - p.dogX, ddz = tz - p.dogZ, dd = hyp(ddx, ddz), st = Math.min(dd, (p.speed + 1.2) * dt * 1.2); if (dd > 0.02) { p.dogX += ddx / dd * st; p.dogZ += ddz / dd * st; p.dogYaw += clamp(angDiff(Math.atan2(ddx, ddz), p.dogYaw), -5 * dt, 5 * dt); }
        const run = p.speed > 0.1 && dd > 0.03; props.put(k, p.dogX, run ? Math.abs(Math.sin(time * 11 + p.id)) * 0.025 * D.size : 0, p.dogZ, p.dogYaw, D.size, p.col, 0, run ? 0.06 * Math.sin(time * 11 + p.id) : 0);
        props.lead(p.x + lx * D.side * 0.25 * sc + fx * 0.12, 0.8 * sc, p.z + lz * D.side * 0.25 * sc + fz * 0.12, p.dogX + Math.sin(p.dogYaw) * 0.19 * D.size, 0.45 * D.size, p.dogZ + Math.cos(p.dogYaw) * 0.19 * D.size); } }
    for (let k = dropped.length - 1; k >= 0; k--) { const d = dropped[k]; if (time > d.until) { dropped.splice(k, 1); continue; } props.put(d.kind, d.x, d.y, d.z, d.yaw, d.scale, d.col, d.roll); }
    const pst = props.end();
    for (const Tn of [mid, far]) { Tn.mesh.instanceMatrix.needsUpdate = true; Tn.iA.needsUpdate = true; Tn.iV.needsUpdate = true; } shadows.instanceMatrix.needsUpdate = true;
    // decals
    let di = 0; for (let k = decList.length - 1; k >= 0; k--) { const d = decList[k], age = time - d.born; if (age > d.life || !gore) { decList.splice(k, 1); continue; } }
    for (const d of decList) { const age = time - d.born, a = clamp(age / 0.25) * clamp((d.life - age) / 14); EU.set(0, d.rot, 0); Q.setFromEuler(EU); M4.compose(V3.set(d.x, d.y, d.z), Q, SC.set(d.size, 1, d.size)); decals.setMatrixAt(di, M4); decD.array[di * 4] = a; decD.array[di * 4 + 1] = d.v; di++; }
    decals.count = di; decals.instanceMatrix.needsUpdate = true; decD.needsUpdate = true; decMat.uniforms.uLight.value = light === 'night' ? 0.3 : light === 'dusk' ? 0.6 : 1;
    for (let k = carDecals.length - 1; k >= 0; k--) { const d = carDecals[k], age = time - d.born; d.m.material.opacity = clamp((d.life - age) / 12); if (age > d.life || !gore) { d.m.parent?.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); d.t.dispose(); carDecals.splice(k, 1); } }
    stat.near = nearN; stat.mid = mi; stat.far = fi; stat.calls = nearN + (mi ? 1 : 0) + (fi ? 1 : 0) + (si ? 1 : 0) + (di ? 1 : 0) + pst.calls; stat.props = pst.tris;
    let tr = mi * mid.tris + fi * far.tris + si * 2 + di * 2 + pst.tris; for (const p of order) if (p.tier === 0 && p.fig) tr += p.fig.tris; stat.tris = tr;
  }
  let warmFigs = false;
  const figCount = () => { let n = 0; for (const p of people) if (p.fig) n++; return n; };
  const nearPoseInit = p => { const P = newPose(); if (p.speed > 0.12) poseWalk(P, p.phase, p.amp || 1, p.K, {}); else poseStatic(P, p.pose, p.K); return P; };

  // ---- frame ---------------------------------------------------------------------------------------------------------------------------------------------
  const pcs = {}, tcs = [];
  /** Once per frame, after the driving code moved the cars. playerState (optional): { x, z, onFoot, car } — otherwise the player's car comes from the drive hooks. */
  function update(dt, camera, playerState = null) {
    if (disposed || !(dt > 0)) return; const t0 = performance.now(); dt = Math.min(dt, 0.1); time += dt; frame++;
    let trafficArg = null; if (camera && !camera.isCamera) { const o = camera; camera = o.camera; trafficArg = o.traffic || null; if (o.player) playerState = o.player.onFoot ? o.player : { car: o.player.car || o.player }; }
    if (!camera) return;
    if (settings && settings.blood != null && !!settings.blood !== gore) { gore = !!settings.blood; if (!gore) decList.length = 0; }
    if (typeof opts.lightMode === 'function') light = opts.lightMode(); else if (city && !opts.lightMode && city.mode) light = city.mode();
    if (city && city.advance && !opts.externalClock) city.advance(dt);
    camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    cam.x = camera.position.x; cam.y = camera.position.y; cam.z = camera.position.z; camera.getWorldDirection(V3); cam.yaw = Math.atan2(V3.x, V3.z); audio.setListener(cam.x, cam.z, cam.yaw);
    // cars near the camera
    cars.length = 0; let ti = 0; const pc = playerState?.car ? carState(playerState.car, pcs) : (playerState?.onFoot ? null : drive.player());
    if (pc) { pc.player = true; cars.push(pc); }
    const eachTraffic = trafficArg ? cb => { for (const c of trafficArg) if (c && !c.taken) cb(c); } : cb => drive.traffic(cb);
    eachTraffic(car => { if (pc && (car === pc.ref || car === pc.ref?.car)) return; const p = car.pos || car; const x = car.x ?? p.x, z = car.z ?? p.z; if (Math.abs(x - cam.x) > 95 || Math.abs(z - cam.z) > 95) { if (car.driver && hyp(x - cam.x, z - cam.z) > 110) { removePerson(car.driver); if (car.passenger) removePerson(car.passenger); } return; } const c = carState(car, tcs[ti] || (tcs[ti] = {})); ti++; c.player = false; cars.push(c);
      if (!car.driver && opts.autoOccupants !== false && occupantCount() < B.occupants && hyp(x - cam.x, z - cam.z) < 70 && !car.taken && !car.noOccupants && car.hadDriver !== true) { if (hiddenAt(x, z) || true) { attachOccupants(car); car.hadDriver = true; } } });
    if (city) { spawnT -= dt; if (spawnT <= 0 || warm) { spawnT = 0.5; spawnTick(); } }
    grid.clear(); for (const p of people) { if (p.gone || p.d2 > B.simR * B.simR || p.state === 'seat') continue; const k = gkey(p.x, p.z); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(p); }
    for (const p of people) { if (p.gone) continue; const ox = p.x, oz = p.z; simulate(p, dt);
      if (p.state === 'enter' && p.st > 1 && city && city.blocked && city.blocked(p.x, p.z)) { stat.entered++; removePerson(p); continue; }
      if (FREE[p.state] && city && city.blocked && city.blocked(p.x, p.z) && !city.blocked(ox, oz)) { p.x = ox; p.z = oz; p.speed = 0; if (p.state === 'flee') { const t = p.fx; p.fx = p.x + (p.z - p.fz); p.fz = p.z - (p.x - t); } } }
    carsVsPeople(dt);
    for (let i = people.length - 1; i >= 0; i--) if (people[i].gone) people.splice(i, 1);
    draw(dt, camera);
    stat.ms += (performance.now() - t0 - stat.ms) * 0.05; stat.count = people.length;
  }
  const occupantCount = () => { let n = 0; for (const p of people) if (p.car) n++; return n; };
  const colOut = [];
  /** Soft obstacles for the car physics: people standing or walking near (x, z). → [{ x, z, r, person }] (array reused). */
  function colliders(x, z, radius = 30) { colOut.length = 0; for (const p of people) { if (p.gone || p.car || p.state === 'rag') continue; if (Math.abs(p.x - x) < radius && Math.abs(p.z - z) < radius) colOut.push({ x: p.x, z: p.z, r: p.state === 'dead' || p.state === 'down' ? 0.5 : 0.28, person: p }); } return colOut; }
  /** People on the carriageway (crossing, lying) as obstacles for the traffic AI: → [{ x, z }]. */
  function roadObstacles() { const out = []; for (const p of people) { if (p.gone || p.car) continue; if (p.state === 'cross' || p.state === 'down' || p.state === 'dead' || p.state === 'rag' || (p.state === 'dodge')) out.push({ x: p.x, z: p.z }); } return out; }

  const api = {
    group: root, people, audio, stats: () => ({ ...stat, ms: +stat.ms.toFixed(3), decals: decList.length, anchors: anchors.size }), update, onCarHit: (car, person, impulse) => onCarHit(car, person, impulse, true), hornAt, alarm,
    attachOccupants, canPullOut, pullOutDriver, canEject: canPullOut, ejectDriver: (car, side) => pullOutDriver(car, side && typeof side === 'object' ? side : null),
    /** From the driving code: { car, person?, speed?, pos?, dir? } — with a person: that person is hit; without: a crash that people nearby react to. */
    onImpact(evt = {}) { if (evt.person) return onCarHit(evt.car, evt.person, evt.speed != null ? { speed: evt.speed, dx: evt.dir?.x ?? evt.dir?.[0], dz: evt.dir?.z ?? evt.dir?.[1] } : null, evt.byPlayer !== false);
      const c = evt.pos || evt.point || (evt.car && carState(evt.car, {})); if (!c) return null; const x = c.x ?? c[0], z = c.z ?? c[2] ?? c[1], sp = evt.speed ?? 6; if (sp < 1.5) return null; const n = alarm(x, z, clamp(sp / 14, 0.2, 1), 12 + Math.min(20, sp * 1.5)); if (n >= 3 && sp > 5) audio.gasp(x, z, n); return { witnesses: n }; },
    setDensity(k) { dens = Math.max(0, +k || 0); warm = dens > 0; if (dens === 0) for (const p of people) if (p.route && !p.anchor && !p.car && !p.keep && !UPRIGHT_BUSY[p.state]) removePerson(p); }, get density() { return dens; }, setBlood(v) { api.setGore(v); if (settings) settings.blood = !!v; }, colliders, roadObstacles, makeActor, makePerson,
    on(evt, cb) { (L[evt] = L[evt] || []).push(cb); return api; }, off(evt, cb) { L[evt] = (L[evt] || []).filter(f => f !== cb); return api; },
    get gore() { return gore; }, setGore(v) { gore = !!v; if (!gore) { decList.length = 0; } }, setLightMode(m) { light = m; opts.lightMode = m; }, setCity(c) { city = cityAdapter(c, opts.cityOptions); warm = true; }, setDrive(d) { drive = driveAdapter(d, { carSpec: opts.carSpec }); },
    get city() { return city; }, get drive() { return drive; }, get time() { return time; },
    /** Add one person by hand (tests, scripted scenes): → person. state 'idle' stands still. */
    add({ seed = null, x = 0, z = 0, yaw = 0, state = 'idle', pose = 'stand', role, age, gender } = {}) { const p = addPerson(makeTraits(seed ?? newSeed(), { role, age, gender }), x, z, yaw, state); p.pose = pose; p.until = 1e9; p.keep = true; return p; },
    remove: removePerson, prewarm(on = true) { warmFigs = on; }, refill() { warm = true; },
    nearestPavement(x, z) { const ne = city && city.nearestEdge(x, z, 120); return ne ? { x: ne.x, z: ne.z } : { x, z }; },
    dispose() { disposed = true; for (const p of people) if (p.fig) p.fig.dispose(); people.length = 0; for (const T of [mid, far]) { T.geo.dispose(); T.mat.dispose(); } props.dispose(); shGeo.dispose(); shadows.material.dispose(); shTex.dispose(); decGeo.dispose(); decMat.dispose(); decTex.dispose(); palTex.dispose(); for (const d of carDecals) d.m.parent?.remove(d.m); drive.off?.(); audio.stopSirens?.(); if (!opts.audio) audio.dispose(); root.parent?.remove(root); },
  };
  // horn from the driving code
  drive.on('drive:collision', d => { if (d && (d.hard || (d.speed || 0) > 4)) api.onImpact({ car: d.car, pos: d.point ? { x: d.point[0], z: d.point[2] } : null, speed: d.speed }); });
  drive.on('drive:horn', d => { if (d && d.on === false) return; const c = drive.player(); const pos = d?.pos || (c ? { x: c.x, z: c.z } : d && d.car ? { x: d.car.x, z: d.car.z } : null);
    const yaw = c ? c.yaw : d && d.car ? d.car.yaw : null; if (pos) hornAt(pos, 24, yaw != null && isFinite(yaw) ? { fx: Math.sin(yaw), fz: Math.cos(yaw), hw: c ? c.W / 2 : 0.95 } : null); });
  return api;
}
