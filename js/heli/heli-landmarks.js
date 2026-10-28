// heli-landmarks.js — V26: hand-built landmark models placed on their OpenStreetMap footprints (the OSM block of city.js
// stays inside them): Ужгородський замок (palace ring around the courtyard, hip roofs, four corner bastions as drawn in OSM)
// and the Хрестовоздвиженський кафедральний собор (baroque nave, two façade towers with bell-shaped helmets, lanterns, crosses).
// Low-poly but shaped after photos; plain colours + a canvas window texture; no external model files.
import * as THREE from 'three';

const hyp = Math.hypot;
function areaS(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function ccw(p) { return areaS(p) > 0 ? p.slice() : p.slice().reverse(); }
/** Mitred inward offset of a CCW ring by d (negative = outward); null when it collapses. */
function inset(poly, d) {
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    let e1x = b[0] - a[0], e1z = b[1] - a[1], e2x = c[0] - b[0], e2z = c[1] - b[1]; const l1 = hyp(e1x, e1z) || 1, l2 = hyp(e2x, e2z) || 1; e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
    const n1x = -e1z, n1z = e1x, n2x = -e2z, n2z = e2x; let mx = n1x + n2x, mz = n1z + n2z; const ml = hyp(mx, mz);
    if (ml < 1e-5) { out.push([b[0] + n1x * d, b[1] + n1z * d]); continue; }
    mx /= ml; mz /= ml; const k = Math.min(3, 1 / Math.max(0.3, mx * n1x + mz * n1z)); out.push([b[0] + mx * d * k, b[1] + mz * d * k]);
  }
  if (d > 0 && (areaS(out) <= 0 || Math.abs(areaS(out)) < 20)) return null;
  return out;
}
function simplify(p, tol = 0.8) { const out = []; for (let i = 0; i < p.length; i++) { const a = out.length ? out[out.length - 1] : p[p.length - 1], b = p[i]; if (hyp(b[0] - a[0], b[1] - a[1]) > tol) out.push(b); } return out.length >= 3 ? out : p; }

class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  tri(a, b, c, ua = [0, 0], ub = [1, 0], uc = [1, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = hyp(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const [v, u] of [[a, ua], [b, ub], [c, uc]]) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.uv.push(u[0], u[1]); }
  }
  quad(a, b, c, d, u0 = 0, u1 = 1, v0 = 0, v1 = 1) { this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1]); this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1]); }
  /** Vertical wall band along a ring (outward faces for a CCW ring), uv: u = metres / uScale, v = 0..1. */
  walls(ring, y0, y1, uScale = 4, inward = false) {
    let s = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], l = hyp(b[0] - a[0], b[1] - a[1]);
      const A = [a[0], y0, a[1]], Bv = [b[0], y0, b[1]], C = [b[0], y1, b[1]], D = [a[0], y1, a[1]];
      if (inward) this.quad(Bv, A, D, C, (s + l) / uScale, s / uScale, 0, 1); else this.quad(A, Bv, C, D, s / uScale, (s + l) / uScale, 0, 1); s += l; }
  }
  /** Sloped band between two rings (same vertex count). */
  band(r0, y0, r1, y1) { for (let i = 0; i < r0.length; i++) { const j = (i + 1) % r0.length; this.quad([r0[i][0], y0, r0[i][1]], [r0[j][0], y0, r0[j][1]], [r1[j][0], y1, r1[j][1]], [r1[i][0], y1, r1[i][1]]); } }
  cap(ring, y, down = false) { const t = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []); for (const [a, b, c] of t) { const A = [ring[a][0], y, ring[a][1]], Bv = [ring[b][0], y, ring[b][1]], C = [ring[c][0], y, ring[c][1]]; if (down) this.tri(A, Bv, C); else this.tri(A, C, Bv); } }
  box(cx, y0, cz, w, h, d, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), P = (x, z) => [cx + x * c + z * s, cz - x * s + z * c];
    const r = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
    this.walls(ccw(r), y0, y0 + h, 3); this.cap(ccw(r), y0 + h);
  }
  build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.computeBoundingSphere(); return g; }
}

function windowTexture(base, frame, glass, rows, opts = {}) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.06)'; for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 128, 1);           // render texture
  if (opts.plinth) { g.fillStyle = opts.plinth; g.fillRect(0, 226, 128, 30); }
  if (opts.cornice) { g.fillStyle = opts.cornice; g.fillRect(0, 0, 128, 10); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 10, 128, 3); }
  const rh = (opts.plinth ? 210 : 236) / rows;
  for (let r = 0; r < rows; r++) { const y = 16 + r * rh + rh * 0.18, h = rh * 0.52;
    g.fillStyle = frame; g.fillRect(40, y - 4, 48, h + 8); g.fillStyle = glass; g.fillRect(46, y, 36, h);
    if (opts.arch) { g.beginPath(); g.arc(64, y, 18, Math.PI, 0); g.fill(); } g.fillStyle = frame; g.fillRect(63, y, 2, h); }
  if (opts.pilaster) { g.fillStyle = opts.pilaster; g.fillRect(0, 0, 10, 256); g.fillRect(118, 0, 10, 256); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

/** Bell-shaped baroque helmet + lantern + cross (local, base at y = 0). */
function helmet(size, roofMat, goldMat) {
  const g = new THREE.Group(), s = size;
  const prof = [[0.62, 0], [0.66, 0.05], [0.6, 0.1], [0.5, 0.24], [0.56, 0.42], [0.5, 0.58], [0.3, 0.72], [0.16, 0.8], [0.12, 0.84], [0.0, 0.86]].map(([x, y]) => new THREE.Vector2(x * s, y * s * 1.25));
  const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 8), roofMat); bell.rotation.y = Math.PI / 8; g.add(bell);
  const lan = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.13 * s, 0.32 * s, 8), roofMat); lan.position.y = 1.15 * s; g.add(lan);
  const cap = new THREE.Mesh(new THREE.LatheGeometry([[0.15, 0], [0.16, 0.04], [0.09, 0.16], [0.03, 0.26], [0, 0.3]].map(([x, y]) => new THREE.Vector2(x * s, y * s)), 8), roofMat); cap.position.y = 1.31 * s; g.add(cap);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045 * s, 10, 8), goldMat); ball.position.y = 1.63 * s; g.add(ball);
  const cv = new THREE.Mesh(new THREE.BoxGeometry(0.03 * s, 0.36 * s, 0.03 * s), goldMat); cv.position.y = 1.83 * s; g.add(cv);
  const ch = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.03 * s, 0.03 * s), goldMat); ch.position.y = 1.9 * s; g.add(ch);
  return g;
}

/**
 * buildLandmarks({ CD, D, scene }) → { group, boxes: [{ x0, z0, x1, z1, h }], list: [{ id, x, z, h }], dispose }
 */
export function buildLandmarks({ CD, D }) {
  const group = new THREE.Group(); group.name = 'heli-landmarks';
  const own = [], boxes = [], list = [];
  const add = (m) => { group.add(m); if (m.geometry) own.push(m.geometry); return m; };
  const roofTile = new THREE.MeshStandardMaterial({ color: '#8c4630', roughness: 0.75 });
  const darkRoof = new THREE.MeshStandardMaterial({ color: '#3d4744', roughness: 0.42, metalness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d8b056', roughness: 0.3, metalness: 1 });
  const paving = new THREE.MeshStandardMaterial({ color: '#b3aa98', roughness: 0.9 });
  own.push(roofTile, darkRoof, gold, paving);
  const bbox = (ring, h) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } boxes.push({ x0, z0, x1, z1, h }); return { x0, z0, x1, z1 }; };

  // ---------------------------------------------------------------- Ужгородський замок
  {
    const [cx, cz] = D.llToWorld(48.62165, 22.30683);
    const b = CD.buildingsNear(cx, cz, 80).filter(b => b.kind === 'castle').sort((p, q) => hyp(p.c[0] - cx, p.c[1] - cz) - hyp(q.c[0] - cx, q.c[1] - cz))[0];
    if (b) {
      const outer = inset(ccw(simplify(b.poly)), -0.45), H = Math.max(14, b.h + 2.2);
      const wallTex = windowTexture('#e8e0cc', '#cfc4aa', '#3a3f45', 2, { plinth: '#b9ad94', cornice: '#d9cfb6' }); own.push(wallTex);
      const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 }); own.push(wallMat);
      const gw = new Geo(), gr = new Geo(), gp = new Geo();
      gw.walls(outer, 0, H, 4.2);
      const ridge = inset(outer, 6.5), inner = inset(outer, 13);
      if (ridge && inner) {                                        // ring palace around the courtyard
        gr.band(outer, H, ridge, H + 5.2); gr.band(inner, H, ridge, H + 5.2);
        gw.walls(inner, 0, H, 4.2, true); gp.cap(inner, 0.25);
      } else if (ridge) { gr.band(outer, H, ridge, H + 5.2); gr.cap(ridge, H + 5.2); }
      else gr.cap(outer, H);
      const mw = add(new THREE.Mesh(gw.build(), wallMat)); mw.name = 'castle-walls';
      const mr = add(new THREE.Mesh(gr.build(), roofTile)); mr.name = 'castle-roof'; mr.material.side = THREE.DoubleSide;
      if (gp.p.length) add(new THREE.Mesh(gp.build(), paving));
      // corner bastion caps: the four outermost vertices get a small pyramid roof (as on photos of the corner towers)
      const cen = outer.reduce((a, p) => [a[0] + p[0] / outer.length, a[1] + p[1] / outer.length], [0, 0]);
      const far = outer.map(p => [p, hyp(p[0] - cen[0], p[1] - cen[1])]).sort((p, q) => q[1] - p[1]).slice(0, 4).map(p => p[0]);
      for (const p of far) { const dx = p[0] - cen[0], dz = p[1] - cen[1], l = hyp(dx, dz) || 1, x = p[0] - dx / l * 4.5, z = p[1] - dz / l * 4.5;
        const t = new THREE.Mesh(new THREE.ConeGeometry(5.6, 6.5, 4), roofTile); t.position.set(x, H + 3.2, z); t.rotation.y = Math.atan2(dx, dz) + Math.PI / 4; add(t); }
      // flag pole on the gate side
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), gold); pole.position.set(cen[0], H + 9, cen[1]); add(pole);
      bbox(outer, H + 6); list.push({ id: 'castle', x: cen[0], z: cen[1], h: H + 6 });
    }
  }

  // ---------------------------------------------------------------- Хрестовоздвиженський кафедральний собор
  {
    const [cx, cz] = D.llToWorld(48.62287, 22.30227);
    const b = CD.buildingsNear(cx, cz, 60).filter(b => /собор/i.test(b.name || '') || b.kind === 'church').sort((p, q) => hyp(p.c[0] - cx, p.c[1] - cz) - hyp(q.c[0] - cx, q.c[1] - cz))[0];
    if (b) {
      const ring = ccw(simplify(b.poly));
      // the same frame city.js uses for this building (longest edge, its tower end) — our model encloses the OSM block
      const poly = b.poly, n0 = poly.length; let best = 0, bl = 0; for (let i = 0; i < n0; i++) { const l = hyp(poly[(i + 1) % n0][0] - poly[i][0], poly[(i + 1) % n0][1] - poly[i][1]); if (l > bl) { bl = l; best = i; } }
      const ux = (poly[(best + 1) % n0][0] - poly[best][0]) / bl, uz = (poly[(best + 1) % n0][1] - poly[best][1]) / bl, vx = -uz, vz = ux, ang = Math.atan2(uz, ux), mx = b.c[0], mz = b.c[1];
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const p of poly) { const a = (p[0] - mx) * ux + (p[1] - mz) * uz, c = (p[0] - mx) * vx + (p[1] - mz) * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, c); b1 = Math.max(b1, c); }
      const sCity = Math.max(3, Math.min(7, (b1 - b0) * 0.42)), front = CD.cityHash(b.id, 3) < 0.5 ? -1 : 1;
      a0 -= 0.5; a1 += 0.5; b0 -= 0.5; b1 += 0.5;
      const P = (a, c, y) => [mx + ux * a + vx * c, y, mz + uz * a + vz * c];
      const Hn = b.h + 0.4, W = b1 - b0, ridgeH = Hn + Math.min(9.6, W / 2 * 1.25) + 0.4;
      const wallTex = windowTexture('#efe6cf', '#e2d6b6', '#3d4146', 2, { arch: true, pilaster: '#e6dcc0', cornice: '#f4ecd8', plinth: '#cfc3a6' }); own.push(wallTex);
      const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.82 }); own.push(wallMat);
      const gw = new Geo(), gr = new Geo();
      const rect = ccw([[P(a0, b0, 0)[0], P(a0, b0, 0)[2]], [P(a1, b0, 0)[0], P(a1, b0, 0)[2]], [P(a1, b1, 0)[0], P(a1, b1, 0)[2]], [P(a0, b1, 0)[0], P(a0, b1, 0)[2]]]);
      gw.walls(rect, 0, Hn, 4.5);
      // gable roof along the axis, with gable triangles at both ends
      const bm = (b0 + b1) / 2;
      gr.quad(P(a0, b0, Hn), P(a1, b0, Hn), P(a1, bm, ridgeH), P(a0, bm, ridgeH)); gr.quad(P(a1, b1, Hn), P(a0, b1, Hn), P(a0, bm, ridgeH), P(a1, bm, ridgeH));
      const gt = new Geo(); gt.tri(P(a0, b1, Hn), P(a0, b0, Hn), P(a0, bm, ridgeH)); gt.tri(P(a1, b0, Hn), P(a1, b1, Hn), P(a1, bm, ridgeH));
      const roof = add(new THREE.Mesh(gr.build(), darkRoof)); roof.material.side = THREE.DoubleSide; roof.name = 'cathedral-roof';
      add(new THREE.Mesh(gw.build(), wallMat)).name = 'cathedral-walls';
      const plain = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.85, side: THREE.DoubleSide }); own.push(plain);
      add(new THREE.Mesh(gt.build(), plain));
      // two towers at the façade corners + the pediment between them
      const af = front > 0 ? a1 : a0, tw = sCity + 0.6, Ht = Math.max(b.h * 1.7, ridgeH + 4) + 0.6, towerTex = windowTexture('#efe6cf', '#e2d6b6', '#2e3236', 4, { arch: true, pilaster: '#e2d7bb', cornice: '#f6eedc' }); own.push(towerTex);
      const towerMat = new THREE.MeshStandardMaterial({ map: towerTex, roughness: 0.82 }); own.push(towerMat);
      for (const side of [-1, 1]) {
        const cb = side < 0 ? b0 + 0.5 + sCity * 0.6 : b1 - 0.5 - sCity * 0.6, ca = front > 0 ? a1 - 0.5 - sCity * 0.6 : a0 + 0.5 + sCity * 0.6, c = P(ca, cb, 0);
        const g = new Geo(); g.box(c[0], 0, c[2], tw, Ht, tw, -ang); const m = add(new THREE.Mesh(g.build(), towerMat)); m.name = 'cathedral-tower';
        const cor = new Geo(); cor.box(c[0], Ht, c[2], tw + 0.8, 0.7, tw + 0.8, -ang); add(new THREE.Mesh(cor.build(), plain));
        const hm = helmet(tw * 1.08, darkRoof, gold); hm.position.set(c[0], Ht + 0.7, c[2]); hm.rotation.y = -ang; group.add(hm); hm.traverse(o => o.geometry && own.push(o.geometry));
      }
      { const pd = new Geo(), y0 = Hn, y1 = Hn + 5.5, A = af + front * 0.7; pd.tri(P(A, b0 + tw, y0), P(A, b1 - tw, y0), P(A, bm, y1)); pd.tri(P(A, b1 - tw, y0), P(A, b0 + tw, y0), P(A, bm, y1)); add(new THREE.Mesh(pd.build(), plain)); }
      // small dome over the crossing with a cross
      { const d = helmet(5.2, darkRoof, gold), c = P((a0 + a1) / 2 - front * (a1 - a0) * 0.18, bm, ridgeH - 1.2); d.position.set(c[0], c[1], c[2]); d.scale.setScalar(0.85); group.add(d); d.traverse(o => o.geometry && own.push(o.geometry)); }
      bbox(rect, Ht + tw * 2.1); list.push({ id: 'cathedral', x: mx, z: mz, h: Ht + tw * 2.1 });
    }
  }
  group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { group, boxes, list, dispose() { for (const o of own) o.dispose && o.dispose(); group.parent && group.parent.remove(group); } };
}
