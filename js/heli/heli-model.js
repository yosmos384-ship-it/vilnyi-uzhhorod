// heli-model.js — V26: the helicopter. ORIGINAL design (no TV / film helicopter, no maker's shape or logo):
// a sleek civilian / rescue twin-turbine, gloss black with a graphite belly and a thin silver line, swept nose with a
// wrap-around tinted canopy, shrouded tail fan with a swept fin, five-blade main rotor, skids, hoist, searchlight.
// Registration «UR-VLN» (fictional) and a small «VILNYI» on the tail. Nose = +z, up = +y, right side = −x … see SIDE below.
// Procedural geometry only (no model files). PBR materials pick up scene.environment (environment.js' sky PMREM).
import * as THREE from 'three';

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
// fuselage stations: z, half-width, half-height, centre y (skids at y = 0)
const ST = [
  [-2.35, 0.36, 0.42, 1.78], [-2.0, 0.55, 0.62, 1.70], [-1.4, 0.80, 0.86, 1.56], [-0.6, 0.90, 0.92, 1.48], [0.3, 0.92, 0.93, 1.45],
  [1.1, 0.91, 0.90, 1.42], [1.9, 0.86, 0.84, 1.36], [2.6, 0.74, 0.72, 1.26], [3.15, 0.56, 0.56, 1.13], [3.55, 0.36, 0.38, 1.02], [3.82, 0.15, 0.17, 0.96], [3.93, 0.02, 0.03, 0.95],
];
const RING = 28;
function station(z) { let i = 0; while (i < ST.length - 2 && ST[i + 1][0] < z) i++; const a = ST[i], b = ST[i + 1], t = Math.max(0, Math.min(1, (z - a[0]) / (b[0] - a[0]))), s = t * t * (3 - 2 * t) * 0.35 + t * 0.65; return [lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)]; }
// superellipse section, flatter belly
function sect(th, w, h, yc) { const c = Math.cos(th), s = Math.sin(th), e = 2.6, px = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * w, py = Math.sign(s) * Math.pow(Math.abs(s), 2 / (s < 0 ? 3.4 : e)) * h; return [px, yc + py]; }
// canopy sector: z range and lower edge angle (beltline drops towards the nose: chin windows)
const CAN = { z0: 0.95, z1: 3.5 };
const canLo = (z) => THREE.MathUtils.degToRad(lerp(-6, -48, sm(2.3, 3.4, z)));
const inCanopy = (z, th) => { if (z < CAN.z0 || z > CAN.z1) return false; let a = th; if (a > Math.PI * 1.5) a -= Math.PI * 2; const lo = canLo(z); return a > lo && a < Math.PI - lo; };

function paintTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  // u = along the body (tail → nose), v = angle around (0 = right side, .25 top, .5 left side, .75 belly)
  g.fillStyle = '#101113'; g.fillRect(0, 0, 1024, 512);
  const vy = (deg) => ((deg % 360 + 360) % 360) / 360 * 512;
  g.fillStyle = '#34373c'; g.fillRect(0, vy(196), 1024, vy(344) - vy(196));                     // graphite belly
  g.fillStyle = '#b9bec4'; g.fillRect(0, vy(347) - 2, 1024, 4); g.fillRect(0, vy(193) - 2, 1024, 4); // silver pin-stripe both sides
  g.fillStyle = '#26282c'; for (const u of [180, 470, 690]) { g.fillRect(u, 0, 2, 512); }        // panel lines
  g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 1024, Math.random() * 512, 30, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function canopyTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256); g.fillStyle = 'rgba(16,17,19,1)';
  // u = z (canopy z0..z1), v = angle (lo..π-lo mapped to 0..1). Frames: door frames and the centre post.
  // side posts only below / beside the roof (no hoop across the windshield), a thin roof edge, a slim centre post
  for (const u of [0.0, 0.43, 0.66]) { g.fillRect(u * 512, 0, 6, 74); g.fillRect(u * 512, 182, 6, 74); }
  g.fillRect(0.66 * 512, 70, 6, 116);                                                            // windshield top edge (roof)
  g.fillRect(0, 126, 0.66 * 512, 4); g.fillRect(0.66 * 512, 126, 512, 3);                        // centre posts
  g.fillRect(506, 0, 6, 256); g.fillRect(0, 0, 512, 4); g.fillRect(0, 252, 512, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function decal(text, sub, w = 1024, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.clearRect(0, 0, w, h);
  g.fillStyle = '#c9ced3'; g.font = `700 ${h * 0.5}px Arial, Helvetica, sans-serif`; g.textBaseline = 'middle'; g.fillText(text, 10, h * 0.38);
  if (sub) { g.font = `600 ${h * 0.22}px Arial, Helvetica, sans-serif`; g.fillStyle = '#8f969d'; g.fillText(sub, 14, h * 0.82); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function discTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), m = S / 2;
  const gr = g.createRadialGradient(m, m, 0, m, m, m); gr.addColorStop(0, 'rgba(30,31,34,0.0)'); gr.addColorStop(0.12, 'rgba(30,31,34,0.5)'); gr.addColorStop(0.2, 'rgba(30,31,34,0.22)');
  gr.addColorStop(0.85, 'rgba(30,31,34,0.18)'); gr.addColorStop(0.95, 'rgba(60,62,66,0.32)'); gr.addColorStop(0.99, 'rgba(60,62,66,0.0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'destination-out'; g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (let r = 0.25; r < 0.95; r += 0.11) { g.lineWidth = 2; g.beginPath(); g.arc(m, m, r * m, 0, 7); g.stroke(); }
  const t = new THREE.CanvasTexture(c); return t;
}
function glowTexture() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }

/** createHeli({ phone }) → heli object; see the return value at the end. */
export function createHeli({ phone = false } = {}) {
  const root = new THREE.Group(); root.name = 'heli';
  const body = new THREE.Group(); root.add(body);              // body tilts (pitch / roll); root = position + yaw
  const own = [];
  const M = {
    paint: new THREE.MeshPhysicalMaterial({ map: paintTexture(), metalness: 0.0, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 0.35, side: THREE.DoubleSide }),
    graphite: new THREE.MeshPhysicalMaterial({ color: '#33363b', metalness: 0.2, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
    black: new THREE.MeshStandardMaterial({ color: '#0c0d0f', metalness: 0.3, roughness: 0.55 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 1, roughness: 0.22 }),
    exhaust: new THREE.MeshStandardMaterial({ color: '#3a3433', metalness: 0.9, roughness: 0.45 }),
    blade: new THREE.MeshStandardMaterial({ color: '#1a1b1e', metalness: 0.3, roughness: 0.45, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#14191e', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.5, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    frame: new THREE.MeshStandardMaterial({ map: canopyTexture(), transparent: true, alphaTest: 0.5, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide }),
    interior: new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.85, side: THREE.DoubleSide }),
    seat: new THREE.MeshStandardMaterial({ color: '#2a2b2f', roughness: 0.7 }),
    tread: new THREE.MeshStandardMaterial({ color: '#5a5d61', roughness: 0.6, metalness: 0.4 }),
  };
  for (const k in M) own.push(M[k]), M[k].map && own.push(M[k].map);
  const add = (geo, mat, parent = body, name) => { const m = new THREE.Mesh(geo, mat); if (name) m.name = name; parent.add(m); own.push(geo); return m; };

  // ---------------- fuselage loft (canopy sector left open; the canopy mesh fills it)
  {
    const zs = []; for (let i = 0; i <= 40; i++) zs.push(lerp(ST[0][0], ST[ST.length - 1][0], i / 40));
    const pos = [], uv = [], idx = [], cpos = [], cuv = [], cidx = [];
    const zL = ST[0][0], zH = ST[ST.length - 1][0];
    const ring = (z, scale) => { const [w, h, yc] = station(z); const out = []; for (let k = 0; k <= RING; k++) { const th = k / RING * Math.PI * 2, [x, y] = sect(th, w * scale, h * scale, yc); out.push([x, y, z, th]); } return out; };
    const rings = zs.map(z => ring(z, 1));
    rings.forEach(r => r.forEach(([x, y, z, th]) => { pos.push(x, y, z); uv.push((z - zL) / (zH - zL), th / (Math.PI * 2)); }));
    for (let i = 0; i < zs.length - 1; i++) for (let k = 0; k < RING; k++) {
      const zm = (zs[i] + zs[i + 1]) / 2, thm = (k + 0.5) / RING * Math.PI * 2; if (inCanopy(zm, thm)) continue;
      const a = i * (RING + 1) + k, b = a + 1, c = a + RING + 1, d = c + 1; idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    add(g, M.paint, body, 'fuselage');
    // canopy: same loft, a hair larger, only its sector; uv over the sector for the frame texture
    const zc = []; for (let i = 0; i <= 24; i++) zc.push(lerp(CAN.z0, CAN.z1, i / 24));
    const CK = 22;
    zc.forEach((z, i) => { const lo = canLo(z), [w, h, yc] = station(z); for (let k = 0; k <= CK; k++) { const th = lo + (Math.PI - 2 * lo) * k / CK, [x, y] = sect(th, w * 1.006, h * 1.006, yc); cpos.push(x, y, z); cuv.push((z - CAN.z0) / (CAN.z1 - CAN.z0), k / CK); } });
    for (let i = 0; i < zc.length - 1; i++) for (let k = 0; k < CK; k++) { const a = i * (CK + 1) + k, b = a + 1, c = a + CK + 1, d = c + 1; cidx.push(a, b, c, b, d, c); }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2)); cg.setIndex(cidx); cg.computeVertexNormals();
    const glass = add(cg, M.glass, body, 'canopy'); glass.renderOrder = 10;
    const fr = new THREE.Mesh(cg, M.frame); fr.scale.setScalar(1.002); fr.name = 'canopy-frame'; body.add(fr);
  }
  // ---------------- engine deck: twin turbine cowling, intakes, exhausts
  {
    const cow = new THREE.CapsuleGeometry(0.46, 2.1, 6, 14); cow.rotateX(Math.PI / 2); cow.scale(1.25, 0.62, 1); cow.translate(0, 2.33, -0.55); add(cow, M.paint, body, 'cowling');
    for (const s of [-1, 1]) {
      const intake = new THREE.CylinderGeometry(0.19, 0.22, 0.28, 14, 1, true); intake.rotateX(Math.PI / 2); intake.translate(s * 0.38, 2.42, 0.62); add(intake, M.graphite);
      const ih = new THREE.CircleGeometry(0.18, 14); ih.translate(s * 0.38, 2.42, 0.62 + 0.13); add(ih, M.black);
      const ex = new THREE.CylinderGeometry(0.15, 0.19, 0.55, 12, 1, true); ex.rotateX(Math.PI / 2); ex.rotateY(s * 0.55); ex.translate(s * 0.62, 2.3, -1.65); add(ex, M.exhaust);
    }
    const mast = new THREE.CylinderGeometry(0.11, 0.15, 0.55, 12); mast.translate(0, 2.78, 0.05); add(mast, M.chrome);
    const fair = new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); fair.scale(1, 0.45, 1.25); fair.translate(0, 2.55, 0.05); add(fair, M.paint);
  }
  // ---------------- tail boom, swept fin with shrouded fan, stabiliser with end plates
  const tailFan = new THREE.Group();
  {
    const boom = new THREE.CylinderGeometry(0.2, 0.38, 5.6, 16, 1); boom.rotateX(Math.PI / 2); boom.translate(0, 1.82, -4.95); add(boom, M.paint, body, 'boom');
    // fin: extruded swept profile, a ring duct
    const fin = new THREE.Shape(); fin.moveTo(-0.95, -0.55); fin.lineTo(0.55, -0.55); fin.lineTo(0.25, 0.75); fin.lineTo(-0.2, 1.9); fin.lineTo(-0.85, 1.95); fin.lineTo(-1.15, 0.6); fin.lineTo(-0.95, -0.55);
    const hole = new THREE.Path(); hole.absarc(-0.25, 0.05, 0.42, 0, Math.PI * 2, true); fin.holes.push(hole);
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 18 });
    fg.translate(0, 0, -0.12); fg.rotateY(Math.PI / 2); fg.translate(0, 1.85, -7.9); add(fg, M.paint, body, 'fin');
    const duct = new THREE.TorusGeometry(0.44, 0.06, 8, 28); duct.rotateY(Math.PI / 2); duct.translate(0, 1.9, -7.65); add(duct, M.graphite);
    tailFan.position.set(0, 1.9, -7.65); body.add(tailFan);
    for (let i = 0; i < 9; i++) { const bl = new THREE.BoxGeometry(0.02, 0.36, 0.07); bl.translate(0, 0.2, 0); const m = add(bl, M.blade, tailFan); m.rotation.x = i / 9 * Math.PI * 2; }
    const hubT = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 10); hubT.rotateZ(Math.PI / 2); add(hubT, M.chrome, tailFan);
    const stab = new THREE.BoxGeometry(2.3, 0.07, 0.48); stab.translate(0, 1.82, -6.55); add(stab, M.paint);
    for (const s of [-1, 1]) { const ep = new THREE.BoxGeometry(0.05, 0.55, 0.5); ep.translate(s * 1.15, 1.9, -6.6); add(ep, M.paint); }
  }
  // ---------------- skids (rescue-style high gear), steps
  {
    for (const s of [-1, 1]) {
      const path = new THREE.CurvePath(); const P = (x, y, z) => new THREE.Vector3(x, y, z);
      path.add(new THREE.LineCurve3(P(s * 1.12, 0.06, -1.55), P(s * 1.12, 0.06, 1.75)));
      path.add(new THREE.QuadraticBezierCurve3(P(s * 1.12, 0.06, 1.75), P(s * 1.12, 0.06, 2.25), P(s * 1.12, 0.32, 2.35)));
      add(new THREE.TubeGeometry(path, 24, 0.055, 8), M.graphite);
      for (const z of [-0.95, 1.25]) { const cv = new THREE.QuadraticBezierCurve3(P(s * 1.12, 0.06, z), P(s * 1.12, 0.62, z), P(s * 0.62, 0.66, z)); add(new THREE.TubeGeometry(cv, 10, 0.05, 8), M.graphite); }
      const step = new THREE.BoxGeometry(0.34, 0.04, 0.5); step.translate(s * 1.18, 0.42, 1.55); add(step, M.tread);
    }
  }
  // ---------------- rescue kit: hoist on the left, searchlight + sensor ball under the nose
  {
    const arm = new THREE.BoxGeometry(0.7, 0.12, 0.14); arm.translate(0.92, 2.12, 0.65); add(arm, M.graphite);
    const hoist = new THREE.CylinderGeometry(0.13, 0.13, 0.4, 12); hoist.rotateZ(Math.PI / 2); hoist.translate(1.25, 2.0, 0.65); add(hoist, M.graphite);
    const ball = new THREE.SphereGeometry(0.2, 16, 12); ball.translate(0, 0.46, 2.85); add(ball, M.graphite);
    const lens = new THREE.CircleGeometry(0.11, 14); lens.translate(0, 0.46, 3.06); add(lens, M.black);
    const sl = new THREE.CylinderGeometry(0.13, 0.1, 0.22, 12); sl.rotateX(Math.PI / 2 - 0.5); sl.translate(0.32, 0.55, 2.4); add(sl, M.chrome);
    const ant = new THREE.BoxGeometry(0.03, 0.32, 0.12); ant.translate(0, 0.42, -0.8); add(ant, M.black);
  }
  // ---------------- tail decals: registration + small name (both sides read correctly)
  {
    const dt = decal('UR-VLN', 'VILNYI · RESCUE');
    const dm = new THREE.MeshBasicMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); own.push(dt, dm);
    for (const s of [-1, 1]) { const g = new THREE.PlaneGeometry(1.7, 0.42); const m = add(g, dm); m.position.set(s * 0.26, 1.84, -4.3); m.rotation.y = s * Math.PI / 2; m.rotation.x = 0; }
  }
  // ---------------- crew doors (hinged at the front edge, opening outward-forward): the pilot's on the right (−x: nose +z,
  // so seen from the cockpit the right hand side is −x), the front passenger's on the left (+x)
  const SIDE = -1;                                              // pilot sits on the right seat (x < 0); the visitor on the left
  function makeDoor(side) {
    const door = new THREE.Group(); door.name = side === SIDE ? 'door' : 'door-passenger'; body.add(door);
    const hx = side * 0.86, hz = 2.15; door.position.set(hx, 0, hz);
    const pos = [], uv = [], NZ = 10, NK = 10;
    const thOf = (k) => { const t = lerp(-0.62, 0.95, k); return side < 0 ? Math.PI + t : -t; };
    for (let i = 0; i <= NZ; i++) { const z = lerp(1.08, 2.12, i / NZ), [w, h, yc] = station(z); for (let k = 0; k <= NK; k++) { const [x, y] = sect(thOf(k / NK), w * 1.012, h * 1.012, yc); pos.push(x - hx, y, z - hz); uv.push(i / NZ, k / NK); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const lowerIdx = [], upperIdx = []; for (let i = 0; i < NZ; i++) for (let k = 0; k < NK; k++) { const a = i * (NK + 1) + k, b = a + 1, c = a + NK + 1, d = c + 1; (k < 4 ? lowerIdx : upperIdx).push(a, b, c, b, d, c); }
    g.setIndex([...lowerIdx, ...upperIdx]); g.computeVertexNormals();
    const gl = g.clone(); gl.setIndex(lowerIdx); const gu = g.clone(); gu.setIndex(upperIdx); own.push(g);
    add(gl, M.paint, door, 'door-skin'); const dg = add(gu, M.glass, door, 'door-glass'); dg.renderOrder = 11;
    const handle = new THREE.BoxGeometry(0.03, 0.04, 0.2); handle.translate(side * 0.06, 1.28, -0.75); add(handle, M.chrome, door);
    // the aperture behind the door (dark interior), shown while the door is open
    const ap = new THREE.Group(); body.add(ap); ap.visible = false;
    const ppos = [], pidx = [], AZ = 6, AK = 8;
    for (let i = 0; i <= AZ; i++) { const z = lerp(1.1, 2.1, i / AZ), [w, h, yc] = station(z); for (let k = 0; k <= AK; k++) { const t = lerp(-0.6, 0.9, k / AK), [x, y] = sect(side < 0 ? Math.PI + t : -t, w * 1.002, h * 1.002, yc); ppos.push(x, y, z); } }
    for (let i = 0; i < AZ; i++) for (let k = 0; k < AK; k++) { const a = i * (AK + 1) + k, b = a + 1, c = a + AK + 1, d = c + 1; pidx.push(a, b, c, b, d, c); }
    const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3)); ag.setIndex(pidx); ag.computeVertexNormals();
    add(ag, M.interior, ap, 'aperture');
    return { door, ap, side };
  }
  const D1 = makeDoor(SIDE), D2 = makeDoor(-SIDE), door = D1.door;
  // ---------------- cockpit interior (seen in the cockpit view and through the canopy)
  const panel = { canvas: document.createElement('canvas'), tex: null, last: 0 };
  {
    panel.canvas.width = 512; panel.canvas.height = 160; panel.tex = new THREE.CanvasTexture(panel.canvas); panel.tex.colorSpace = THREE.SRGBColorSpace; own.push(panel.tex);
    const floor = new THREE.BoxGeometry(1.5, 0.05, 2.3); floor.translate(0, 0.72, 1.6); add(floor, M.interior);
    const dash = new THREE.BoxGeometry(1.45, 0.42, 0.32); dash.translate(0, 1.2, 2.62); add(dash, M.interior, body, 'dash');
    const glare = new THREE.BoxGeometry(1.5, 0.05, 0.42); glare.translate(0, 1.43, 2.6); add(glare, M.black);
    const screenMat = new THREE.MeshBasicMaterial({ map: panel.tex, toneMapped: false }); own.push(screenMat);
    const scr = new THREE.PlaneGeometry(1.3, 0.38); scr.rotateY(Math.PI); scr.rotateX(-0.25); scr.translate(0, 1.21, 2.455); add(scr, screenMat, body, 'screens');
    const cons = new THREE.BoxGeometry(0.3, 0.42, 0.7); cons.translate(0, 0.95, 2.05); add(cons, M.interior);
    for (const x of [-0.42, 0.42]) {
      const seat = new THREE.BoxGeometry(0.5, 0.12, 0.5); seat.translate(x, 0.95, 1.45); add(seat, M.seat);
      const back = new THREE.BoxGeometry(0.5, 0.75, 0.1); back.rotateX(-0.18); back.translate(x, 1.36, 1.17); add(back, M.seat);
      const stick = new THREE.CylinderGeometry(0.02, 0.025, 0.5, 6); stick.translate(x, 1.0, 1.95); add(stick, M.black);
      const grip = new THREE.CylinderGeometry(0.035, 0.03, 0.13, 8); grip.translate(x, 1.29, 1.95); add(grip, M.black);
    }
    const over = new THREE.BoxGeometry(0.4, 0.08, 0.7); over.translate(0, 2.18, 1.55); add(over, M.interior);
  }
  // anchors
  const seat = new THREE.Object3D(); seat.position.set(SIDE * 0.42, 0.98, 1.42); body.add(seat);
  const eye = new THREE.Object3D(); eye.position.set(-SIDE * 0.42, 1.86, 1.66); body.add(eye);      // the visitor's eye (front passenger seat)
  const pilotEye = new THREE.Object3D(); pilotEye.position.set(SIDE * 0.42, 1.86, 1.66); body.add(pilotEye);
  const doorStep = new THREE.Vector3(SIDE * 1.75, 0, 1.6);       // where the pilot stands before climbing in (local)
  const pDoorStep = new THREE.Vector3(-SIDE * 1.75, 0, 1.6);     // in front of the passenger door

  // ---------------- main rotor
  const rotor = new THREE.Group(); rotor.position.set(0, 3.08, 0.05); body.add(rotor);
  const blades = new THREE.Group(); rotor.add(blades);
  const R = 5.6, NB = 5;
  {
    const hub = new THREE.CylinderGeometry(0.26, 0.3, 0.2, 16); add(hub, M.chrome, rotor);
    const cap = new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, 0.1, 0); add(cap, M.graphite, rotor);
    for (let i = 0; i < NB; i++) {
      const g = new THREE.BoxGeometry(R - 0.3, 0.035, 0.34, 12, 1, 1); g.translate((R - 0.3) / 2 + 0.3, 0, 0);
      const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k), t = x / R; p.setZ(k, p.getZ(k) * (1 - 0.35 * Math.max(0, t - 0.85) / 0.15)); p.setY(k, p.getY(k) + Math.sin(t * 2.2) * 0.0); if (t > 0.93 && p.getZ(k) > 0) p.setZ(k, p.getZ(k) - (t - 0.93) * 3.2); }
      g.computeVertexNormals(); const b = add(g, M.blade, blades); b.rotation.y = i / NB * Math.PI * 2; b.userData.base = b.rotation.y;
      const tip = new THREE.BoxGeometry(0.12, 0.04, 0.34); tip.translate(R - 0.06, 0, 0); const t = add(tip, M.chrome, blades); t.rotation.y = b.rotation.y;
    }
  }
  const discTex = discTexture(); own.push(discTex);
  const discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, color: '#ffffff' }); own.push(discMat);
  const disc = add(new THREE.CircleGeometry(R + 0.05, 48).rotateX(-Math.PI / 2), discMat, rotor, 'rotor-disc'); disc.renderOrder = 12;
  const tdMat = discMat.clone(); own.push(tdMat);
  const tdisc = add(new THREE.CircleGeometry(0.42, 24).rotateY(Math.PI / 2), tdMat, tailFan, 'fan-disc'); tdisc.renderOrder = 12;

  // ---------------- lights: nav (red left / green right / white tail), anti-collision beacons, strobes, landing light
  const glow = glowTexture(); own.push(glow);
  const lights = [];
  const mkLight = (x, y, z, col, size, kind) => { const m = new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); own.push(m); const s = new THREE.Sprite(m); s.position.set(x, y, z); s.scale.setScalar(size); body.add(s); lights.push({ s, kind, size }); return s; };
  mkLight(1.0, 1.82, 0.05 - 6.55 + 6.55 - 6.55, '#ff2a1a', 0.5, 'nav');   // left stabiliser tip (x > 0 = left side)
  lights[0].s.position.set(1.18, 1.86, -6.6);
  mkLight(-1.18, 1.86, -6.6, '#1aff4a', 0.5, 'nav');
  mkLight(0, 2.1, -8.35, '#ffffff', 0.45, 'nav');
  mkLight(0, 2.62, -1.4, '#ff2010', 0.75, 'beacon'); mkLight(0, 0.5, -0.4, '#ff2010', 0.75, 'beacon');
  mkLight(1.18, 1.95, -6.6, '#ffffff', 0.9, 'strobe'); mkLight(-1.18, 1.95, -6.6, '#ffffff', 0.9, 'strobe');
  const land = mkLight(0.32, 0.5, 2.55, '#fff6e0', 1.6, 'land');

  // ---------------- state / API
  const S = { rpm: 0, angle: 0, tAngle: 0, door: 0, pdoor: 0, t: 0, mode: 'day', landLight: false };
  function update(dt) {
    S.t += dt;
    const w = S.rpm * 2 * Math.PI * 6.3;                         // 380 rpm at 100 %
    S.angle += w * dt; S.tAngle += S.rpm * 2 * Math.PI * 30 * dt;
    blades.rotation.y = -S.angle; tailFan.rotation.x = S.tAngle;
    const blur = sm(0.25, 0.75, S.rpm);
    blades.visible = blur < 0.97; blades.children.forEach(b => { b.material === M.blade; });
    M.blade.transparent = blur > 0.05; M.blade.opacity = 1 - blur * 0.92; M.blade.depthWrite = blur < 0.5;
    discMat.opacity = blur * 0.85; tdMat.opacity = blur * 0.8; disc.rotation.y = -S.angle * 0.13;
    // blade droop at rest, coning when spinning
    const droop = (1 - sm(0, 0.6, S.rpm)) * -0.035 + sm(0.6, 1, S.rpm) * 0.025;
    blades.children.forEach(b => { b.rotation.z = droop; });
    D1.door.rotation.y = SIDE * -S.door * 1.35; D1.ap.visible = S.door > 0.02;
    D2.door.rotation.y = -SIDE * -S.pdoor * 1.35; D2.ap.visible = S.pdoor > 0.02;
    const night = S.mode !== 'day', on = S.rpm > 0.05 || S.door > 0 || S.pdoor > 0;
    for (const L of lights) {
      let k = 0;
      if (L.kind === 'nav') k = on ? 1 : 0;
      else if (L.kind === 'beacon') k = S.rpm > 0.05 ? Math.max(0, Math.sin(S.t * 7.5 + (L.s.position.y > 1 ? 0 : 1.6))) ** 6 : 0;
      else if (L.kind === 'strobe') k = S.rpm > 0.3 && (S.t % 1.3) < 0.06 ? 1 : 0;
      else if (L.kind === 'land') k = S.landLight ? 1 : 0;
      L.s.visible = k > 0.01; L.s.material.opacity = k * (night ? 1 : 0.75); L.s.scale.setScalar(L.size * (night ? 1.6 : 1) * (L.kind === 'land' ? 1.6 : 1));
    }
  }
  /** Instrument panel: called by the app (≈ 8 Hz) with the flight state. */
  function drawPanel(s) {
    const g = panel.canvas.getContext('2d'), W = 512, H = 160; g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
    const scr = (x, w) => { g.fillStyle = '#0b1016'; g.fillRect(x, 8, w, H - 16); g.strokeStyle = '#2a3036'; g.lineWidth = 2; g.strokeRect(x, 8, w, H - 16); };
    // attitude (left PFD)
    scr(8, 160); g.save(); g.beginPath(); g.rect(12, 12, 152, H - 24); g.clip(); g.translate(88, H / 2); g.rotate(-(s.roll || 0)); const py = (s.pitch || 0) * 140;
    g.fillStyle = '#2f6db5'; g.fillRect(-200, -200 + py, 400, 200); g.fillStyle = '#7a5532'; g.fillRect(-200, py, 400, 200); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-200, py); g.lineTo(200, py); g.stroke();
    g.lineWidth = 1; for (let k = -2; k <= 2; k++) if (k) { g.beginPath(); g.moveTo(-14, py - k * 24); g.lineTo(14, py - k * 24); g.stroke(); } g.restore();
    g.strokeStyle = '#ffcf3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(58, H / 2); g.lineTo(80, H / 2); g.lineTo(88, H / 2 + 7); g.lineTo(96, H / 2); g.lineTo(118, H / 2); g.stroke();
    // speed / altitude tapes
    g.font = '700 22px Arial, sans-serif'; g.textAlign = 'center';
    scr(176, 160); g.fillStyle = '#7fe0ff'; g.fillText(String(Math.round(s.kmh || 0)), 216, 72); g.fillStyle = '#8fa0ad'; g.font = '600 12px Arial'; g.fillText('KM/H', 216, 92);
    g.font = '700 22px Arial'; g.fillStyle = '#b9ff7a'; g.fillText(String(Math.round(s.alt || 0)), 296, 72); g.fillStyle = '#8fa0ad'; g.font = '600 12px Arial'; g.fillText('ALT M', 296, 92);
    g.font = '700 18px Arial'; g.fillStyle = '#fff'; g.fillText(String(Math.round(((s.hdg || 0) + 360) % 360)).padStart(3, '0') + '°', 256, 128);
    g.fillStyle = '#ffcf3a'; g.font = '600 12px Arial'; g.fillText((s.vs >= 0 ? '▲ ' : '▼ ') + Math.abs(s.vs || 0).toFixed(1) + ' m/s', 256, 32);
    // map / engine page (right MFD)
    scr(344, 160); g.fillStyle = '#8fa0ad'; g.font = '600 12px Arial'; g.textAlign = 'left'; g.fillText('ENG 1', 356, 34); g.fillText('ENG 2', 356, 88);
    for (const [y, v] of [[44, s.rpm || 0], [98, s.rpm || 0]]) { g.fillStyle = '#1b232b'; g.fillRect(356, y, 136, 12); g.fillStyle = v > 0.95 ? '#5fe08a' : '#ffcf3a'; g.fillRect(356, y, 136 * Math.min(1, v), 12); }
    g.fillStyle = '#7fe0ff'; g.fillText('NR ' + Math.round((s.rpm || 0) * 100) + '%', 356, 136); g.textAlign = 'right'; g.fillText(s.mode === 'tour' ? 'AUTO' : 'MAN', 492, 136);
    panel.tex.needsUpdate = true;
  }
  return {
    root, body, rotor, door, seat, eye, pilotEye, doorStep, pDoorStep, SIDE, R, M, lights,
    get rpm() { return S.rpm; }, set rpm(v) { S.rpm = Math.max(0, Math.min(1.05, v)); },
    get doorOpen() { return S.door; }, set doorOpen(v) { S.door = Math.max(0, Math.min(1, v)); },
    get pDoorOpen() { return S.pdoor; }, set pDoorOpen(v) { S.pdoor = Math.max(0, Math.min(1, v)); },
    set landLight(v) { S.landLight = !!v; },
    setMode(m) { S.mode = m; },
    update, drawPanel,
    /** world position of the door step / hinge (for the cut-scene) */
    localToWorld(v) { return body.localToWorld(v.clone()); },
    dispose() { for (const o of own) o.dispose && o.dispose(); root.parent && root.parent.remove(root); },
  };
}
