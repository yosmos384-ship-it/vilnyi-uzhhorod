// ЖК VILNYI (Uzhhorod) — procedural furniture library (Agent C).
// Every builder: (m = getMaterials(style), opts) → THREE.Group, origin at floor centre, front = +z, real sizes (m).
// Pieces are built from many small meshes; apartment.js bakes (merges) them by material, so detail is cheap in draw calls.
// A group may carry userData.solidBox = {w,d,h,x?,z?} (local footprint for walking collisions) or userData.noSolid.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ geometry helpers (cached, shared)
const GC = new Map();
const cg = (k, f) => { let g = GC.get(k); if (!g) { g = f(); GC.set(k, g); } return g; };
const r3 = v => Math.round(v * 1000) / 1000;
const UB = () => cg('ub', () => new THREE.BoxGeometry(1, 1, 1));

function add(p, geo, mat, x = 0, y = 0, z = 0, rot, scl) {
  const o = new THREE.Mesh(geo, mat);
  o.position.set(x, y, z);
  if (rot) o.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  if (scl) o.scale.set(scl[0], scl[1], scl[2]);
  p.add(o); return o;
}
// box with its BOTTOM at y (x,z = centre)
function box(p, w, h, d, mat, x = 0, y = 0, z = 0, rot) { return add(p, UB(), mat, x, y + h / 2, z, rot, [w, h, d]); }
// rounded box, bottom at y
function rbox(p, w, h, d, rad, mat, x = 0, y = 0, z = 0, rot, seg = 2) {
  rad = Math.min(rad, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const g = cg(`rb${r3(w)}|${r3(h)}|${r3(d)}|${r3(rad)}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, rad));
  return add(p, g, mat, x, y + h / 2, z, rot);
}
// cylinder, bottom at y
function cyl(p, rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 20, rot, open = false) {
  const g = cg(`cy${r3(rt)}|${r3(rb)}|${r3(h)}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  return add(p, g, mat, x, y + h / 2, z, rot);
}
// cylinder centred at (x,y,z) along an axis given by rotation
function rod(p, r, len, mat, x, y, z, rot, seg = 10) {
  const g = cg(`rod${r3(r)}|${r3(len)}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg));
  return add(p, g, mat, x, y, z, rot);
}
function sph(p, r, mat, x = 0, y = 0, z = 0, s = [1, 1, 1], seg = 16, rot) {
  const g = cg(`sp${r3(r)}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.66 | 0)));
  return add(p, g, mat, x, y, z, rot, s);
}
function lathe(p, pts, mat, x = 0, y = 0, z = 0, seg = 24, scl) {
  const key = 'la' + pts.map(q => q.map(r3).join(',')).join(';') + '|' + seg;
  const g = cg(key, () => new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), seg));
  return add(p, g, mat, x, y, z, null, scl);
}
function torus(p, R, r, mat, x, y, z, rot, arc = Math.PI * 2, seg = 24) {
  const g = cg(`to${r3(R)}|${r3(r)}|${r3(arc)}|${seg}`, () => new THREE.TorusGeometry(R, r, 8, seg, arc));
  return add(p, g, mat, x, y, z, rot);
}
function disc(p, r, mat, x, y, z, rot, seg = 24) {
  const g = cg(`di${r3(r)}|${seg}`, () => new THREE.CircleGeometry(r, seg));
  return add(p, g, mat, x, y, z, rot);
}
function plane(p, w, h, mat, x, y, z, rot) {
  const g = cg('pl', () => new THREE.PlaneGeometry(1, 1));
  return add(p, g, mat, x, y, z, rot, [w, h, 1]);
}
// Soft upholstery: a superellipsoid (sphere pushed towards a box). e = per-axis roundness (small = square,
// 1 = round); `pinch` thins the thinnest axis towards the rim like a stuffed pillow; `sag` dips the top centre
// (a sat-in seat). Smooth normals, no UVs (baking projects world UVs).
const sgp = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
function softGeo(w, h, d, e = [0.2, 0.45, 0.2], pinch = 0, sag = 0, seg = 22) {
  return cg(`soft${r3(w)}|${r3(h)}|${r3(d)}|${e.map(r3)}|${r3(pinch)}|${r3(sag)}|${seg}`, () => {
    const s = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7));
    s.deleteAttribute('uv'); s.deleteAttribute('normal');
    const g = mergeVertices(s); s.dispose();
    const p = g.attributes.position, dims = [w, h, d], thin = dims.indexOf(Math.min(w, h, d));
    for (let i = 0; i < p.count; i++) {
      const v = [p.getX(i), p.getY(i), p.getZ(i)].map((c, k) => sgp(c, e[k]) * dims[k] / 2);
      if (pinch) {
        const o = [0, 1, 2].filter(k => k !== thin), q = Math.max(Math.abs(v[o[0]]) / (dims[o[0]] / 2), Math.abs(v[o[1]]) / (dims[o[1]] / 2));
        v[thin] *= 1 - pinch * Math.pow(q, 2.5);
      }
      if (sag && v[1] > 0) { const q = Math.min(1, Math.hypot(v[0] / (w / 2), v[2] / (d / 2))); v[1] -= sag * (1 - q * q) * (v[1] / (h / 2)); }
      p.setXYZ(i, v[0], v[1], v[2]);
    }
    g.computeVertexNormals();
    return g;
  });
}
function soft(p, w, h, d, mat, x = 0, y = 0, z = 0, rot, o = {}) {
  return add(p, softGeo(w, h, d, o.e, o.pinch || 0, o.sag || 0, o.seg || 22), mat, x, y + h / 2, z, rot);
}
// Cloth draped over a rectangular top (bed duvet / runner): flat on top with soft wrinkles, rolling over the
// sides and the foot edge (radius r) and hanging down `drop` with vertical folds. The head edge (z = zH) is cut.
// Local frame: top surface at y = top, x ∈ [-W/2, W/2], z from zH to the foot zF.
function clothGeo(W, zH, zF, top, drop, r = 0.06, seed = 1, off = 0, zFade = zH) {
  return cg(`cloth${r3(W)}|${r3(zH)}|${r3(zF)}|${r3(top)}|${r3(drop)}|${r3(r)}|${seed}|${r3(off)}|${r3(zFade)}`, () => {
    const R = r + off, ext = Math.PI * R / 2 + drop, nx = 64, nz = 56;
    const g = new THREE.PlaneGeometry(1, 1, nx, nz), P = g.attributes.position;
    const xi = W / 2 - r, zi = zF - r, ph = seed * 1.7;
    for (let i = 0; i < P.count; i++) {
      const ix = Math.round((P.getX(i) + 0.5) * nx), iz = Math.round((0.5 - P.getY(i)) * nz);
      const s = -xi - ext + (2 * xi + 2 * ext) * ix / nx, t = zH + (zi + ext - zH) * iz / nz;
      const cx = Math.max(-xi, Math.min(xi, s)), cz = Math.max(zH, Math.min(zi, t));
      const ox = s - cx, oz = t - cz, e = Math.hypot(ox, oz);
      // gentle wrinkles on top (same function for every layer so stacked cloths never intersect)
      const wr = (Math.sin(cx * 7.3 + cz * 2.1 + ph) * Math.sin(cz * 5.7 - cx * 1.3) * 0.011 + Math.sin(cx * 2.2 - cz * 3.1) * 0.006
        + Math.pow(Math.abs(Math.sin(cx * 11.7 - cz * 4.3 + ph * 2)), 6) * 0.006 - Math.pow(Math.abs(Math.sin(cz * 13.1 + cx * 3.7)), 8) * 0.004) * Math.min(1, Math.max(0, cz - zFade) * 6);
      let X = cx, Y = top + off + wr, Z = cz;
      if (e > 1e-5) {
        const dx = ox / e, dz = oz / e, arc = Math.PI * R / 2;
        let hx, y;
        if (e <= arc) { const a = e / R; hx = R * Math.sin(a); y = top + off + wr * Math.cos(a) - R * (1 - Math.cos(a)); }
        else {
          const dd = Math.min(1, (e - arc) / drop), along = Math.abs(dx) > Math.abs(dz) ? cz : cx;
          const fold = (Math.sin(along * 26 + ph + Math.sin(along * 7) * 1.5) * 0.016 + Math.sin(along * 11 + ph * 2) * 0.008) * Math.pow(dd, 0.8);
          hx = R + (e - arc) * 0.05 + fold; y = top + off - R - Math.min(drop, e - arc);
        }
        X = cx + dx * hx; Z = cz + dz * hx; Y = y;
      }
      P.setXYZ(i, X, Y, Z);
    }
    g.computeVertexNormals();
    return g;
  });
}
// ---- baked light / contact-shadow decals (atlas cells: disc, rect, grad, scallop). A quad from its centre and two
// edge vectors: `right` (local +x, full width) and `up` (local +y, full height; the atlas cell's top edge = +up side).
const FXCELL = { disc: [0, 0], rect: [1, 0], grad: [2, 0], scallop: [3, 0], lamp: [0, 1], sun: [1, 1], soft: [2, 1], corner: [3, 1], fall: [0, 2] };
function fxGeo(cell) {
  return cg('fx' + cell, () => {
    const g = new THREE.PlaneGeometry(1, 1), uv = g.attributes.uv, [cx, cy] = FXCELL[cell];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, cx * 0.25 + uv.getX(i) * 0.25, 0.75 - cy * 0.25 + uv.getY(i) * 0.25);
    return g;
  });
}
// Camera-facing light halo marker: apartment.js collects these (after placement) into ONE billboard mesh.
function bloom(p, x, y, z, size = 0.5, k = 1) {
  const o = new THREE.Object3D(); o.position.set(x, y, z); o.userData.bloom = { size, k }; p.add(o); return o;
}
const _fr = new THREE.Vector3(), _fu = new THREE.Vector3(), _fn = new THREE.Vector3();
function fxQuad(p, mat, cell, c, right, up) {
  const o = new THREE.Mesh(fxGeo(cell), mat);
  _fr.set(...right); _fu.set(...up); _fn.crossVectors(_fr, _fu).normalize();
  o.matrixAutoUpdate = false;
  o.matrix.makeBasis(_fr, _fu, _fn).setPosition(c[0], c[1], c[2]);
  p.add(o); return o;
}
// flat on a horizontal surface at height y (facing up, or down if `down`), w along x, d along z; cell top towards -z
function fxFlat(p, mat, cell, x, y, z, w, d, down = false, ang = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return fxQuad(p, mat, cell, [x, y, z], down ? [-w * ca, 0, w * sa] : [w * ca, 0, -w * sa], [-d * sa, 0, -d * ca]);
}
// on a vertical surface facing +z (local), centre (x, y, z), cell top upwards
function fxWallZ(p, mat, cell, x, y, z, w, h) { return fxQuad(p, mat, cell, [x, y, z], [w, 0, 0], [0, h, 0]); }
const grp = (p, x = 0, y = 0, z = 0, ry = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; if (p) p.add(g); return g; };
function rngF(seed) { let s = (seed * 9301 + 49297) % 233280; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const HALF = Math.PI / 2;

// Leaf outline (unit length along +y, width 1), UVs 0..1 for the leaf texture.
function leafGeo(kind = 'lance') {
  return cg('leaf' + kind, () => {
    const s = new THREE.Shape();
    if (kind === 'heart') {
      s.moveTo(0, 0); s.bezierCurveTo(0.35, -0.02, 0.55, 0.35, 0.45, 0.62); s.bezierCurveTo(0.35, 0.86, 0.1, 0.96, 0, 1);
      s.bezierCurveTo(-0.1, 0.96, -0.35, 0.86, -0.45, 0.62); s.bezierCurveTo(-0.55, 0.35, -0.35, -0.02, 0, 0);
    } else if (kind === 'fiddle') {
      // fiddle-leaf fig: narrow at the stalk, broad and wavy towards a blunt tip
      s.moveTo(0, 0); s.bezierCurveTo(0.2, 0.05, 0.28, 0.3, 0.36, 0.5); s.bezierCurveTo(0.5, 0.78, 0.4, 0.97, 0, 1);
      s.bezierCurveTo(-0.4, 0.97, -0.52, 0.76, -0.38, 0.5); s.bezierCurveTo(-0.28, 0.3, -0.2, 0.05, 0, 0);
    } else if (kind === 'monstera') {
      s.moveTo(0, 0); s.bezierCurveTo(0.45, -0.05, 0.62, 0.35, 0.5, 0.66); s.bezierCurveTo(0.4, 0.9, 0.14, 1.0, 0, 0.97);
      s.bezierCurveTo(-0.14, 1.0, -0.4, 0.9, -0.5, 0.66); s.bezierCurveTo(-0.62, 0.35, -0.45, -0.05, 0, 0);
      // fenestrations: elongated holes between the veins, both halves
      for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
        const y = 0.2 + i * 0.18, x = sx * (0.28 + 0.04 * Math.sin(i)), hl = new THREE.Path();
        hl.absellipse(x, y, 0.1, 0.028, 0, Math.PI * 2, false, sx * (0.5 + i * 0.12));
        s.holes.push(hl);
      }
    } else if (kind === 'blade') {
      s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.quadraticCurveTo(0.55, 0.7, 0, 1); s.quadraticCurveTo(-0.55, 0.7, -0.5, 0);
    } else {
      s.moveTo(0, 0); s.quadraticCurveTo(0.6, 0.35, 0, 1); s.quadraticCurveTo(-0.6, 0.35, 0, 0);
    }
    const g = new THREE.ShapeGeometry(s, kind === 'monstera' ? 10 : 6);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + 0.5, pos.getY(i));
    // slight cup so leaves are not perfectly flat
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, x * x * 0.35 - Math.sin(y * Math.PI) * 0.06); }
    g.computeVertexNormals();
    return g;
  });
}
function leaf(p, m, kind, len, wid, x, y, z, rx, ry, rz, mat) {
  return add(p, leafGeo(kind), mat || m.leaf, x, y, z, [rx, ry, rz], [wid, len, len * 0.6]);
}

// Book: box with a baked vertex colour (all books share one material → one draw call).
const BOOKCOL = {
  milano: ['#2b2b2e', '#6b3b24', '#b48c55', '#e3dccf', '#3f4a3c', '#1d1d1f', '#8a2e2a', '#d4c6ae'],
  nordic: ['#e9e5dc', '#1f1f1f', '#8fa3a8', '#c9b89a', '#b86b4b', '#d6d0c4', '#5f6f5c', '#f2efe9'],
  riviera: ['#efe4d0', '#b5623b', '#6b6f48', '#2f4f5f', '#d9b98a', '#c98d5f', '#f5efe4', '#8a6f4e'],
  monaco: ['#1c2947', '#17463a', '#c49a4c', '#ece3d2', '#14171f', '#6b1f2a', '#d9cbb0', '#2b2b2e'],
  kyoto: ['#e9e1d3', '#2f2b28', '#8b8f74', '#b07b5a', '#d6cbb8', '#4b4540', '#f2ede4', '#a69a88'],
  paris: ['#f1ebe0', '#7f97ad', '#d9b0aa', '#a9bccd', '#b8935a', '#1f1d1c', '#e4dccd', '#8a7a6a'],
};
function bookGeo(w, h, d, hex) {
  return cg(`bk${r3(w)}|${r3(h)}|${r3(d)}|${hex}`, () => {
    const g = new THREE.BoxGeometry(w, h, d); const c = new THREE.Color(hex);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    // page edges on the three non-spine faces are lighter: faces order +x,-x,+y,-y,+z,-z (4 verts each); +z = spine
    const page = new THREE.Color('#efe8da');
    for (const f of [0, 1, 2, 5]) for (let k = 0; k < 4; k++) { const i = f * 4 + k; if (f === 2 || f === 3) continue; a[i * 3] = page.r; a[i * 3 + 1] = page.g; a[i * 3 + 2] = page.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  });
}
// Row of upright books along +x starting at x0; returns end x. Spines face +z.
function bookRow(p, m, x0, len, y, z, seed = 1, maxH = 0.3) {
  const r = rngF(seed), pal = (BOOKCOL[m.styleId] || BOOKCOL[m.fam]);
  let x = x0;
  while (x < x0 + len - 0.03) {
    const w = 0.02 + r() * 0.035, h = maxH * (0.7 + r() * 0.3), d = 0.14 + r() * 0.08;
    if (x + w > x0 + len) break;
    const col = pal[(r() * pal.length) | 0];
    add(p, bookGeo(r3(w), r3(h), r3(d), col), m.books, x + w / 2, y + h / 2, z);
    x += w + 0.002;
  }
  return x;
}
// Stack of lying books
function bookStack(p, m, n, x, y, z, seed = 3, ry = 0) {
  const r = rngF(seed), pal = (BOOKCOL[m.styleId] || BOOKCOL[m.fam]); let yy = y;
  for (let i = 0; i < n; i++) {
    const w = 0.2 + r() * 0.1, d = 0.26 + r() * 0.08, h = 0.02 + r() * 0.025;
    const b = add(p, bookGeo(r3(w), r3(h), r3(d), pal[(r() * pal.length) | 0]), m.books, x + (r() - 0.5) * 0.02, yy + h / 2, z, [0, ry + (r() - 0.5) * 0.3, 0]);
    b.userData.book = true; yy += h;
  }
  return yy;
}

// Cushion / pillow: soft rounded block. Lies in XY plane (faces +z) and is tilted back by `tilt`.
function cushion(p, w, h, t, mat, x, y, z, ry = 0, tilt = -0.25) {
  return soft(p, w, h, t, mat, x, y, z, [tilt, ry, 0], { e: [0.4, 0.4, 0.9], pinch: 0.68, seg: 22 });
}
// sofa seat / back cushions (boxy sides, domed faces, a slight sit-in dip)
const seatC = (p, w, h, d, mat, x, y, z, rot) => soft(p, w, h, d, mat, x, y, z, rot, { e: [0.16, 0.42, 0.16], sag: 0.012 });
const backC = (p, w, h, d, mat, x, y, z, rot) => soft(p, w, h, d, mat, x, y, z, rot, { e: [0.18, 0.2, 0.55], pinch: 0.18 });
function vase(p, m, x, y, z, h = 0.3, mat, stems = true) {
  const s = h / 0.3;
  lathe(p, [[0, 0], [0.05 * s, 0], [0.075 * s, 0.08 * s], [0.07 * s, 0.2 * s], [0.035 * s, 0.28 * s], [0.04 * s, 0.3 * s], [0.032 * s, 0.3 * s], [0.028 * s, 0.26 * s]], mat || m.ceramic, x, y, z, 20);
  if (stems && m.styleId === 'kyoto') { ikebana(p, m, x, y, z, h, (x * 100 + z * 10) | 0); return; }
  if (stems) {
    const r = rngF((x * 100 + z * 10) | 0 + 7);
    for (let i = 0; i < 5; i++) {
      const a = r() * 6.28, tl = 0.12 + r() * 0.25, lx = Math.cos(a) * 0.04, lz = Math.sin(a) * 0.04;
      rod(p, 0.003, tl, m.stem, x + lx * 0.5, y + h + tl / 2 - 0.02, z + lz * 0.5, [lz * 3, 0, -lx * 3], 4);
      if (m.fam === 'nordic') leaf(p, m, 'lance', 0.09, 0.05, x + lx, y + h + tl - 0.03, z + lz, 0.3, a, 0.4, m.leaf2);
      else sph(p, 0.028, m.flower, x + lx * 1.4, y + h + tl, z + lz * 1.4, [1, 0.7, 1], 8);
    }
  }
}
function candle(p, m, x, y, z, h = 0.14) {
  cyl(p, 0.035, 0.035, h, m.candle, x, y, z, 14);
  sph(p, 0.008, m.flame, x, y + h + 0.012, z, [1, 1.8, 1], 6);
}
function bowl(p, m, x, y, z, r = 0.14, mat, fruit = true) {
  lathe(p, [[0, 0], [r * 0.45, 0], [r * 0.85, r * 0.35], [r, r * 0.55], [r * 0.95, r * 0.56], [r * 0.8, r * 0.36], [0.001, r * 0.08]], mat || m.ceramic, x, y, z, 24);
  if (fruit) {
    const fm = [m.fruit, m.fruit2, m.fruit, m.fruit3, m.fruit];
    for (let i = 0; i < 5; i++) { const a = i * 1.3; sph(p, r * 0.26, fm[i], x + Math.cos(a) * r * 0.42 * (i ? 1 : 0), y + r * 0.42 + (i ? 0 : r * 0.12), z + Math.sin(a) * r * 0.42 * (i ? 1 : 0), [1, 0.95, 1], 10); }
  }
}
function tray(p, m, x, y, z, w = 0.4, d = 0.28, mat) {
  box(p, w, 0.008, d, mat || m.metal, x, y, z);
  for (const s of [-1, 1]) { box(p, w, 0.025, 0.006, mat || m.metal, x, y, z + s * d / 2); box(p, 0.006, 0.025, d, mat || m.metal, x + s * w / 2, y, z); }
}
// Glass (wine / tumbler): open lathe in crystal
function glass(p, m, x, y, z, kind = 'wine', wine = false) {
  if (kind === 'wine') {
    lathe(p, [[0, 0], [0.035, 0], [0.036, 0.004], [0.004, 0.008], [0.004, 0.1], [0.03, 0.12], [0.042, 0.16], [0.037, 0.21]], m.crystal, x, y, z, 16);
    if (wine) lathe(p, [[0, 0.118], [0.03, 0.125], [0.038, 0.145], [0, 0.145]], m.wine, x, y, z, 14);
  } else {
    lathe(p, [[0, 0], [0.032, 0], [0.036, 0.1], [0.033, 0.1], [0.029, 0.006], [0, 0.006]], m.crystal, x, y, z, 16);
  }
}
function plate(p, m, x, y, z, r = 0.14, mat) {
  lathe(p, [[0, 0], [r * 0.6, 0], [r * 0.75, 0.008], [r, 0.02], [r * 0.97, 0.022], [r * 0.72, 0.012], [0, 0.012]], mat || m.porcelain, x, y, z, 28);
}
// Cutlery lying on the table: fork, knife, spoon (thin boxes), along z
function cutlery(p, m, x, y, z, side) {
  const c = m.cutlery;
  // fork
  box(p, 0.012, 0.004, 0.13, c, x - side * 0.0, y, z + 0.02);
  for (let i = 0; i < 4; i++) box(p, 0.0025, 0.003, 0.05, c, x - 0.0045 + i * 0.003, y, z - 0.065);
  return c;
}
function placeSetting(p, m, x, y, z, ry = 0) {
  const g = grp(p, x, y, z, ry);
  if (m.fam !== 'nordic') plate(g, m, 0, 0, 0, 0.155, m.fam === 'milano' ? m.ceramic2 : m.ceramic);
  plate(g, m, 0, m.fam !== 'nordic' ? 0.012 : 0, 0, 0.13, m.porcelain);
  plate(g, m, 0, (m.fam !== 'nordic' ? 0.024 : 0.012), 0, 0.1, m.fam === 'riviera' ? m.ceramic2 : m.porcelain);
  // napkin folded, fork left, knife + spoon right
  box(g, 0.1, 0.006, 0.16, m.napkin, -0.225, 0, 0.01, [0, 0.05, 0]);
  box(g, 0.012, 0.004, 0.13, m.cutlery, -0.225, 0.006, 0.03);
  for (let i = 0; i < 4; i++) box(g, 0.0025, 0.003, 0.05, m.cutlery, -0.2295 + i * 0.003, 0.006, -0.058);
  box(g, 0.012, 0.004, 0.2, m.cutlery, 0.19, 0, 0);
  box(g, 0.016, 0.004, 0.06, m.cutlery, 0.19, 0, -0.07);           // knife blade (wider)
  box(g, 0.01, 0.004, 0.14, m.cutlery, 0.22, 0, 0.03);
  sph(g, 0.02, m.cutlery, 0.22, 0.004, -0.06, [1, 0.25, 1.4], 8);   // spoon bowl
  glass(g, m, 0.14, 0, -0.2, 'wine', true);
  glass(g, m, 0.21, 0, -0.16, 'tumbler');
  return g;
}

// ================================================================== OPENABLE JOINERY
// A "mover" is a group whose meshes animate together (a door leaf with its handle, a drawer with its box and
// contents). Its origin is the pivot: the hinge line of a door, the closed position of a drawer. apartment.js pulls
// movers out of the static bake into one dynamic batch (constant draw calls) and gives each an invisible click
// proxy carrying the aptDoor action + toggle(). A "compartment" is an empty marker whose build(group, m) fills the
// cabinet lazily on first opening (and shows it only while a door of it is open: the interior LED "switches on").
// spec: {type:'hinge', axis:'y'|'x', angle} | {type:'slide', dir, dist}; comp: compartment; excl: shared key →
//       opening one closes the others (sliding wardrobe panels).
const OPEN = 1.75;                                        // ~100°
// contents use mulberry32 (rngF's small LCG gives correlated consecutive draws → colour picks repeat)
function rngM(seed) { let a = (seed * 2654435761) >>> 0 || 7; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mover(p, x, y, z, spec) { const g = grp(p, x, y, z); g.userData.mover = spec; return g; }
function compartment(p, build, x = 0, y = 0, z = 0) { const o = new THREE.Object3D(); o.position.set(x, y, z); o.userData.compartment = { build }; p.add(o); return o; }
// Door leaf hinged on its left (side -1, pivot at x0) or right (side +1, pivot at x1) edge; z = back face of the leaf.
// Children are placed relative to the pivot: the leaf's centre is at x = -side * w/2.
function hinged(p, x0, x1, y0, z, side, comp, o = {}) {
  // Ry(θ) takes (+x, 0) to (cos θ, −sin θ): a left-hinged leaf (extending +x) swings out to +z with θ < 0
  const mv = mover(p, side < 0 ? x0 : x1, y0, z, { type: 'hinge', axis: 'y', angle: side * (o.angle || OPEN), comp, dur: o.dur });
  mv.userData.cx = -side * (x1 - x0) / 2; return mv;
}
// Bottom-hinged flap (oven, dishwasher): pivot at the bottom edge, falls towards +z.
const flap = (p, x, y, z, comp, angle = 1.45) => mover(p, x, y, z, { type: 'hinge', axis: 'x', angle, comp, dur: 750 });
const drawerMv = (p, x, y, z, dist = 0.4, comp) => mover(p, x, y, z, { type: 'slide', dir: [0, 0, 1], dist, comp, dur: 520 });

// vertex-coloured copy of a cached geometry (one material → many colours in one draw call)
const TG = new Map();
function tintGeo(geo, hex) {
  const k = geo.uuid + hex; let g = TG.get(k);
  if (!g) {
    g = geo.clone(); const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); TG.set(k, g);
  }
  return g;
}
const tint = (o, hex) => { o.geometry = tintGeo(o.geometry, hex); return o; };
const cbox = (p, w, h, d, hex, mat, x, y, z, rot) => tint(box(p, w, h, d, mat, x, y, z, rot), hex);

// Hollow cabinet carcass (w × h × d, bottom at y, front plane at z + d/2): back, sides, top, bottom in `inM`.
function shell(p, inM, w, h, d, x = 0, y = 0, z = 0, t = 0.016, o = {}) {
  box(p, w, h, t, inM, x, y, z - d / 2 + t / 2);
  if (o.sides !== false) for (const s of [-1, 1]) box(p, t, h, d - t, inM, x + s * (w / 2 - t / 2), y, z + t / 2);
  if (o.top !== false) box(p, w - 2 * t, t, d - t, inM, x, y + h - t, z + t / 2);
  if (o.bottom !== false) box(p, w - 2 * t, t, d - t, inM, x, y, z + t / 2);
}
// Interior light: LED line under a shelf edge + a warm wash down the back panel and a pool on the base.
function ledWash(g, m, x, w, y0, y1, zb, zf, mat) {
  const L = mat === m.coldGlow ? m.coldLed : m.led;
  box(g, w - 0.02, 0.006, 0.012, L, x, y1 - 0.012, zf - 0.03);
  fxQuad(g, mat || m.glow, 'grad', [x, (y0 + y1) / 2, zb + 0.004], [w - 0.02, 0, 0], [0, y1 - y0, 0]);
  fxFlat(g, mat === m.coldGlow ? m.coldGlow : m.glowFaint, 'grad', x, y0 + 0.004, (zb + zf) / 2, w - 0.02, zf - zb);
}

// ---------------------------------------------------------------- contents library (all in the piece's local frame)
const WEAR = {
  milano: { shirts: ['#f1eee8', '#c9d6e3', '#e8e0d2', '#ffffff', '#9fb0c4'], dark: ['#2e2e33', '#1f2a3d', '#161616', '#6b6a6a', '#3b3a3d'], warm: ['#a8794e', '#7a4526', '#5e1f27', '#8a7d6d', '#c4a27a'], bags: ['#7a4526', '#161616', '#e3d8c6', '#5e1f27'], boxes: ['#e7782f', '#161616', '#efe9df', '#c49a5c'] },
  nordic: { shirts: ['#f3f1ec', '#dfe6ec', '#ece5d6', '#ffffff', '#a7b8c6'], dark: ['#1f1f1f', '#56708c', '#4a4a4a', '#6f7c86', '#2d3640'], warm: ['#d9cfbf', '#c4a27a', '#9aa792', '#b9b8b3', '#e2d6c2'], bags: ['#c4a27a', '#1f1f1f', '#e8e1d4', '#8a6f55'], boxes: ['#f2efe9', '#1f1f1f', '#d6d0c4', '#b9a58a'] },
  riviera: { shirts: ['#f6f1e7', '#ece2cf', '#9fbfd0', '#ffffff', '#e8d3bf'], dark: ['#2f4f5f', '#6b6f48', '#3d3a33', '#5a4a3a', '#1f2d36'], warm: ['#b5623b', '#d9c3a0', '#a0522d', '#d9a58f', '#c98d5f'], bags: ['#b98a5a', '#efe4d0', '#a0522d', '#2f4f5f'], boxes: ['#f5efe4', '#b5623b', '#d9c3a0', '#6b6f48'] },
  monaco: { shirts: ['#f4efe6', '#d7deea', '#efe4d2', '#ffffff', '#b8c4d8'], dark: ['#1c2947', '#14171f', '#2b2b2e', '#17463a', '#3b3a3d'], warm: ['#6b1f2a', '#c49a4c', '#17463a', '#8a7d6d', '#e0c9a6'], bags: ['#6b1f2a', '#14171f', '#e8dcc6', '#c49a4c'], boxes: ['#14171f', '#c49a4c', '#f2ece0', '#1c2947'] },
  kyoto: { shirts: ['#f4f0e8', '#e3e0d6', '#ebe3d4', '#ffffff', '#c9cdc2'], dark: ['#2f2b28', '#4b4540', '#5b6153', '#3e3a36', '#6b6358'], warm: ['#b07b5a', '#d6cbb8', '#8b8f74', '#a69a88', '#e2d7c4'], bags: ['#8a6a4e', '#2f2b28', '#e6ddcd', '#b07b5a'], boxes: ['#f2ede4', '#2f2b28', '#d6cbb8', '#a69a88'] },
};
// Garment hanging from a hanger: thin along x, width along z, shoulder line at y = 0, hem at -len.
function garmentGeo(kind, len, wid, th) {
  return cg(`gar${kind}|${r3(len)}|${r3(wid)}|${r3(th)}`, () => {
    const s = new THREE.SphereGeometry(1, 14, 22); s.deleteAttribute('uv'); s.deleteAttribute('normal');
    const g = mergeVertices(s); s.dispose();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const X = sgp(p.getX(i), 0.45), Y = sgp(p.getY(i), 0.14), Z = sgp(p.getZ(i), 0.22);
      const t = (1 - Y) / 2;                                 // 0 at the shoulders → 1 at the hem
      let ws = 1;
      if (kind === 'dress') ws = t < 0.3 ? 0.78 - t * 0.5 : 0.63 + (t - 0.3) * 0.75;
      else if (kind === 'trousers') ws = 0.95;
      else ws = t < 0.06 ? 0.55 + t * 7.5 : 1 - Math.max(0, t - 0.8) * 0.3;
      let y = -t * len;
      if (kind !== 'trousers' && t < 0.2) y -= 0.05 * Math.pow(Math.abs(Z), 1.6) * (1 - t / 0.2);   // sloping shoulders
      const bulk = kind === 'jacket' || kind === 'coat' ? 0.75 + 0.25 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) : 0.6 + 0.4 * Math.sin(Math.min(1, t * 2) * Math.PI / 2);
      // sleeves: the garment is fuller at its two edges (arms hang there) down to the cuff
      const sleeve = kind === 'dress' || kind === 'trousers' ? 1 : 1 + 0.55 * Math.pow(Math.abs(Z), 6) * (t > 0.08 && t < 0.78 ? 1 : 0.4);
      const fold = 1 + 0.06 * Math.sin(Z * 9 + t * 3) * (kind === 'dress' ? t : 0.4);
      p.setXYZ(i, X * th / 2 * bulk * sleeve * fold, y, Z * wid / 2 * ws);
    }
    g.computeVertexNormals();
    return g;
  });
}
function hanger(p, m, x, y, z) {
  const g = grp(p, x, y, z), a = Math.atan2(0.2, 0.055), len = Math.hypot(0.2, 0.055);
  for (const s of [-1, 1]) rod(g, 0.0075, len, m.hanger, 0, -0.0275, s * 0.1, [-s * a, 0, 0], 6);   // "∧" arms
  torus(g, 0.017, 0.0025, m.chrome, 0, 0.03, 0, [0, HALF, -0.6], Math.PI * 1.3, 10);                 // hook over the rail
  rod(g, 0.0025, 0.016, m.chrome, 0, 0.006, 0, null, 6);
  return g;
}
// A rail of hanging clothes along x (x0..x1), rail at height y, rail centre z. mix: kinds to cycle.
function hangRail(p, m, x0, x1, y, z, seed, mix = ['shirt', 'shirt', 'jacket', 'dress'], maxLen = 1.3) {
  const r = rngM(seed), W = (WEAR[m.styleId] || WEAR[m.fam]);
  const L = { shirt: 0.72, jacket: 0.78, dress: 1.12, coat: 1.05, trousers: 0.52 };
  const T = { shirt: 0.05, jacket: 0.085, dress: 0.055, coat: 0.1, trousers: 0.04 };
  let x = x0 + 0.04, i = 0;
  while (x < x1 - 0.05) {
    const kind = mix[(i + (r() * 1.4 | 0)) % mix.length]; i++;
    const th = T[kind], len = Math.min(maxLen, L[kind] * (0.93 + r() * 0.12)), wid = kind === 'trousers' ? 0.36 : kind === 'dress' ? 0.4 : 0.46;
    const pal = kind === 'shirt' ? W.shirts : kind === 'dress' ? W.warm : kind === 'trousers' ? W.dark : r() < 0.6 ? W.dark : W.warm;
    x += th / 2 - 0.004;
    const ry = (r() - 0.5) * 0.7;
    hanger(p, m, x, y - 0.03, z);
    const gm = add(p, garmentGeo(kind, len, wid, th), m.clothes, x, y - 0.045, z + (r() - 0.5) * 0.02, [0, ry, (r() - 0.5) * 0.03]);
    tint(gm, pal[(r() * pal.length) | 0]);
    x += th / 2 + r() * 0.012;
  }
}
// folded knitwear / T-shirts: soft slabs with rounded folds
function foldStack(p, m, x, y, z, n, seed, w = 0.3, d = 0.27, pal) {
  const r = rngM(seed), W = (WEAR[m.styleId] || WEAR[m.fam]), cols = pal || [...W.warm, ...W.shirts];
  let yy = y;
  for (let i = 0; i < n; i++) {
    const h = 0.035 + r() * 0.02;
    tint(soft(p, w * (0.96 + r() * 0.06), h, d * (0.96 + r() * 0.06), m.clothes, x + (r() - 0.5) * 0.015, yy, z + (r() - 0.5) * 0.012, [0, (r() - 0.5) * 0.06, 0], { e: [0.14, 0.55, 0.22], seg: 12 }), cols[(r() * cols.length) | 0]);
    yy += h * 0.94;
  }
  return yy;
}
function shoeBox(p, m, x, y, z, hex, w = 0.34, h = 0.13, d = 0.21, ry = 0) {
  const g = grp(p, x, y, z, ry);
  cbox(g, w - 0.006, h - 0.03, d - 0.006, hex, m.goods, 0, 0, 0);
  cbox(g, w, 0.034, d, hex, m.goods, 0, h - 0.034, 0);
  cbox(g, w * 0.3, 0.02, 0.002, '#f4efe6', m.goods, -w * 0.22, h * 0.45, d / 2);          // label
  return g;
}
function handbag(p, m, x, y, z, hex, ry = 0, s = 1) {
  const g = grp(p, x, y, z, ry);
  tint(soft(g, 0.3 * s, 0.21 * s, 0.13 * s, m.goods, 0, 0, 0, null, { e: [0.2, 0.3, 0.35], seg: 14 }), hex);
  tint(torus(g, 0.085 * s, 0.007, m.goods, 0, 0.2 * s, 0, [0, 0, 0], Math.PI, 14), hex);
  box(g, 0.05 * s, 0.012, 0.004, m.brass, 0, 0.13 * s, 0.066 * s);
  return g;
}
function shoePair(p, m, x, y, z, hex, kind = 'loafer', ry = 0) {
  const g = grp(p, x, y, z, ry);
  for (const s of [-1, 1]) {
    const sh = grp(g, s * 0.055, 0, 0, s * 0.03);
    if (kind === 'heel') {
      tint(soft(sh, 0.075, 0.05, 0.24, m.goods, 0, 0.035, 0.01, [-0.28, 0, 0], { e: [0.35, 0.4, 0.5], seg: 12 }), hex);
      tint(cyl(sh, 0.008, 0.006, 0.08, m.goods, 0, 0, -0.1, 8), hex);
    } else {
      tint(soft(sh, 0.09, 0.07, 0.27, m.goods, 0, 0.008, 0, null, { e: [0.45, 0.3, 0.6], seg: 14 }), hex);
      tint(soft(sh, 0.062, 0.02, 0.13, m.goods, 0, 0.058, -0.045, null, { e: [0.4, 0.5, 0.5], seg: 10 }), '#1c1a18');   // opening
      tint(soft(sh, 0.094, 0.018, 0.272, m.goods, 0, 0, 0, null, { e: [0.4, 0.3, 0.55], seg: 12 }), kind === 'sneaker' ? '#f2f0ec' : '#2a211b');
    }
  }
  return g;
}
function mug(p, m, x, y, z, mat, ry = 0) {
  const g = grp(p, x, y, z, ry);
  lathe(g, [[0, 0], [0.036, 0], [0.04, 0.09], [0.036, 0.09], [0.033, 0.008], [0, 0.008]], mat, 0, 0, 0, 16);
  torus(g, 0.025, 0.006, mat, 0.042, 0.045, 0, [0, 0, 0], Math.PI, 10).rotation.z = -HALF;
  return g;
}
function bowlStack(p, m, x, y, z, n, r, mat) {
  for (let i = 0; i < n; i++) lathe(p, [[0, 0], [r * 0.45, 0], [r * 0.85, r * 0.4], [r, r * 0.62], [r * 0.95, r * 0.63], [r * 0.8, r * 0.42], [0.001, r * 0.08]], mat, x, y + i * r * 0.2, z, 22);
}
function plateStack(p, m, x, y, z, n, r, mat) { for (let i = 0; i < n; i++) plate(p, m, x, y + i * 0.016, z, r, mat); }
function jar(p, m, x, y, z, fill, h = 0.16, r = 0.045, lidM) {
  lathe(p, [[0, 0], [r, 0], [r, h * 0.85], [r * 0.82, h * 0.92], [r * 0.82, h], [0, h]], m.glass, x, y, z, 16);
  tint(cyl(p, r - 0.004, r - 0.004, h * (0.45 + ((x * 31 + z * 17) % 1 + 1) % 1 * 0.35), m.food, x, y + 0.004, z, 14), fill);
  cyl(p, r * 0.86, r * 0.86, 0.022, lidM || (m.fam === 'nordic' ? m.woodLight : m.brass), x, y + h, z, 16);
}
function pack(p, m, x, y, z, w, h, d, hex, band = '#f4efe6', ry = 0) {
  const g = grp(p, x, y, z, ry);
  cbox(g, w, h, d, hex, m.goods, 0, 0, 0);
  cbox(g, w * 0.8, h * 0.28, 0.002, band, m.goods, 0, h * 0.42, d / 2);
  return g;
}
function can(p, m, x, y, z, hex, h = 0.11, r = 0.034) {
  cyl(p, r, r, 0.008, m.steel, x, y, z, 14); tint(cyl(p, r, r, h - 0.016, m.goods, x, y + 0.008, z, 14), hex); cyl(p, r * 0.96, r, 0.008, m.steel, x, y + h - 0.008, z, 14);
}
function bottle(p, m, x, y, z, mat, h = 0.3, r = 0.036, hex) {
  const o = lathe(p, [[0, 0], [r, 0], [r, h * 0.62], [r * 0.34, h * 0.8], [r * 0.3, h], [0, h]], mat, x, y, z, 14);
  if (hex) tint(o, hex);
  return o;
}
function toiletry(p, m, x, y, z, hex, kind = 'pump', h = 0.17) {
  if (kind === 'pump') { tint(lathe(p, [[0, 0], [0.032, 0], [0.034, h * 0.8], [0.02, h * 0.88], [0, h * 0.88]], m.goods, x, y, z, 14), hex); cyl(p, 0.008, 0.008, h * 0.14, m.metal, x, y + h * 0.86, z, 8); box(p, 0.03, 0.008, 0.01, m.metal, x + 0.01, y + h * 0.97, z); }
  else if (kind === 'jar') { tint(cyl(p, 0.035, 0.035, 0.05, m.goods, x, y, z, 16), hex); cyl(p, 0.036, 0.036, 0.018, m.metal, x, y + 0.05, z, 16); }
  else if (kind === 'perfume') { box(p, 0.05, 0.075, 0.03, m.crystal, x, y, z); tint(box(p, 0.044, 0.05, 0.024, m.food, x, y + 0.004, z), hex); cyl(p, 0.013, 0.013, 0.026, m.brass, x, y + 0.075, z, 12); }
  else { tint(rbox(p, 0.04, h, 0.025, 0.01, m.goods, x, y, z), hex); tint(cyl(p, 0.009, 0.009, 0.02, m.goods, x, y + h, z, 8), '#f4f1ea'); }   // tube / flat bottle
}
function towelRoll(p, m, x, y, z, mat, len = 0.3) { soft(p, len, 0.1, 0.1, mat, x, y, z, [0, 0, 0], { e: [0.12, 0.9, 0.9], seg: 14 }); }
// Stove pot with lid, handles; open lathe walls so an empty one reads as a pot from above
function pot(p, m, x, y, z, r = 0.1, h = 0.12, lid = true) {
  const g = grp(p, x, y, z);
  lathe(g, [[0, 0.004], [r * 0.9, 0], [r, 0.012], [r, h], [r - 0.005, h], [r - 0.005, 0.014], [0, 0.012]], m.steel, 0, 0, 0, 24);
  for (const s of [-1, 1]) box(g, 0.035, 0.012, 0.024, m.steel, s * (r + 0.015), h - 0.03, 0);
  if (lid) { lathe(g, [[0, 0.03], [r * 0.5, 0.024], [r + 0.004, 0], [r - 0.004, 0], [0, 0.02]], m.crystal, 0, h, 0, 24); cyl(g, 0.015, 0.012, 0.025, m.blackMetal, 0, h + 0.028, 0, 10); }
  return g;
}
function pan(p, m, x, y, z, r = 0.13, ry = 0) {
  const g = grp(p, x, y, z, ry);
  lathe(g, [[0, 0], [r * 0.92, 0], [r, 0.045], [r - 0.004, 0.045], [r * 0.9, 0.006], [0, 0.006]], m.blackMetal, 0, 0, 0, 24);
  rod(g, 0.009, 0.16, m.blackMetal, r + 0.075, 0.035, 0, [0, 0, HALF + 0.12], 8);
  return g;
}
// Cutlery tray (along z = drawer depth), organised: forks, knives, spoons, teaspoons, utensils
function cutleryTray(p, m, x, y, z, w, d) {
  const g = grp(p, x, y, z), tm = m.fam === 'milano' ? m.woodDark : m.woodLight, c = m.cutlery;
  box(g, w, 0.008, d, tm, 0, 0, 0);
  for (const s of [-1, 1]) { box(g, 0.008, 0.045, d, tm, s * (w / 2 - 0.004), 0, 0); box(g, w, 0.045, 0.008, tm, 0, 0, s * (d / 2 - 0.004)); }
  const cols = Math.max(4, Math.floor(w / 0.085)), cw = (w - 0.02) / cols;
  for (let i = 1; i < cols; i++) box(g, 0.006, 0.04, d - 0.02, tm, -w / 2 + 0.01 + i * cw, 0, 0);
  for (let i = 0; i < cols; i++) {
    const cx = -w / 2 + 0.01 + cw * (i + 0.5), kind = i % 4;
    for (let k = 0; k < 4; k++) {
      const yy = 0.01 + k * 0.005, ox = (k - 1.5) * 0.004;
      if (kind === 0) { box(g, 0.01, 0.003, 0.13, c, cx + ox, yy, 0.03); box(g, 0.022, 0.003, 0.055, c, cx + ox, yy, -0.07); }       // forks
      else if (kind === 1) { box(g, 0.011, 0.004, 0.11, c, cx + ox, yy, 0.045); box(g, 0.018, 0.0025, 0.11, c, cx + ox, yy, -0.065); } // knives
      else if (kind === 2) { box(g, 0.01, 0.003, 0.13, c, cx + ox, yy, 0.03); sph(g, 0.021, c, cx + ox, yy + 0.004, -0.065, [1, 0.22, 1.45], 8); } // spoons
      else { box(g, 0.008, 0.003, 0.09, c, cx + ox, yy, 0.02); sph(g, 0.014, c, cx + ox, yy + 0.003, -0.045, [1, 0.22, 1.4], 8); }     // teaspoons
    }
  }
  return g;
}
// fruit & veg (food material, vertex-tinted)
const FOOD = { tomato: '#c23a22', lemon: '#e8c93a', apple: '#8fb23b', orange: '#e48a26', pepper: '#d23b1f', lettuce: '#7aa64a', egg: '#efe3cf', cheese: '#f0c96a', butter: '#f3e3a1', carrot: '#e07a2a', grape: '#5b2a4a', aubergine: '#3a2140' };
function produce(p, m, x, y, z, kind, s = 1) {
  const r = { tomato: 0.035, lemon: 0.03, apple: 0.038, orange: 0.04, pepper: 0.04, lettuce: 0.07 }[kind] * s;
  const o = sph(p, r, m.food, x, y + r * 0.9, z, kind === 'lemon' ? [1, 0.8, 1.3] : kind === 'lettuce' ? [1.1, 0.8, 1] : [1, 0.9, 1], 12, [0, x * 7, 0]);
  return tint(o, FOOD[kind]);
}
function eggBox(p, m, x, y, z, n = 6) {
  cbox(p, 0.12, 0.035, 0.24, '#d8cdb8', m.goods, x, y, z);
  for (let i = 0; i < n; i++) tint(sph(p, 0.022, m.food, x + (i % 2 - 0.5) * 0.055, y + 0.05, z + ((i / 2 | 0) - 1) * 0.07, [1, 1.3, 1], 10), FOOD.egg);
}
function wineGlass(p, m, x, y, z, s = 1) { lathe(p, [[0, 0], [0.035 * s, 0], [0.036 * s, 0.004], [0.004, 0.008], [0.004, 0.1 * s], [0.03 * s, 0.12 * s], [0.042 * s, 0.16 * s], [0.037 * s, 0.21 * s]], m.crystal, x, y, z, 14); }
function tumbler(p, m, x, y, z, inv = false) {
  if (inv) lathe(p, [[0, 0.1], [0.036, 0.1], [0.032, 0], [0.029, 0], [0.033, 0.094], [0, 0.094]], m.crystal, x, y, z, 14);
  else lathe(p, [[0, 0], [0.032, 0], [0.036, 0.1], [0.033, 0.1], [0.029, 0.006], [0, 0.006]], m.crystal, x, y, z, 14);
}
function gameBox(p, m, x, y, z, w, h, d, hex, ry = 0) {
  const g = grp(p, x, y, z, ry);
  cbox(g, w, h, d, hex, m.goods, 0, 0, 0);
  cbox(g, w * 0.6, 0.002, d * 0.35, '#f4efe6', m.goods, -w * 0.1, h, -d * 0.1);
  return g;
}

// Kitchen / crockery fill for a cabinet shelf band (x across, depth zc). kind: 'plates'|'glasses'|'pantry'|'mugs'
function shelfFill(p, m, x0, x1, y, zc, kind, seed) {
  const r = rngM(seed); let x = x0 + 0.03;
  const cm = [m.ceramic, m.porcelain, m.ceramic2];
  if (kind === 'plates') {
    while (x < x1 - 0.13) {
      const k = (r() * 3) | 0;
      if (k < 2) { const R = 0.13 - r() * 0.03; plateStack(p, m, x + R, y, zc, 6 + (r() * 4 | 0), R, cm[k]); x += R * 2 + 0.02; }
      else { bowlStack(p, m, x + 0.08, y, zc, 4, 0.075, cm[(r() * 3) | 0]); x += 0.18; }
    }
  } else if (kind === 'glasses') {
    while (x < x1 - 0.05) {
      if (r() < 0.45) { for (const dz of [-0.07, 0.05]) wineGlass(p, m, x + 0.04, y, zc + dz); x += 0.09; }
      else if (r() < 0.6) { for (const dz of [-0.08, 0, 0.08]) tumbler(p, m, x + 0.04, y, zc + dz, true); x += 0.085; }
      else { mug(p, m, x + 0.045, y, zc - 0.05, cm[(r() * 3) | 0], r() * 3); mug(p, m, x + 0.045, y, zc + 0.06, cm[(r() * 3) | 0], r() * 3); x += 0.11; }
    }
  } else {
    const fills = ['#d9a441', '#b0452a', '#3b2418', '#ece6d6', '#c2862f', '#5f7a2e', '#7a2f2a'];   // pasta, red lentils, coffee, rice, chickpeas, green lentils, beans
    const packs = ['#b8322a', '#1f4e79', '#e6c35a', '#2f5d3a', '#efe6d4', '#c46a2c'];
    while (x < x1 - 0.08) {
      const k = (r() * 3) | 0;
      if (k === 0) { jar(p, m, x + 0.05, y, zc - 0.04, fills[(r() * fills.length) | 0], 0.14 + r() * 0.06); jar(p, m, x + 0.05, y, zc + 0.07, fills[(r() * fills.length) | 0], 0.12); x += 0.11; }
      else if (k === 1) { const w = 0.07 + r() * 0.04, h = 0.2 + r() * 0.08; pack(p, m, x + w / 2, y, zc, w, h, 0.17, packs[(r() * packs.length) | 0], '#f4efe6', (r() - 0.5) * 0.08); x += w + 0.015; }
      else { can(p, m, x + 0.035, y, zc - 0.05, packs[(r() * packs.length) | 0]); can(p, m, x + 0.035, y, zc + 0.05, packs[(r() * packs.length) | 0]); can(p, m, x + 0.035, y + 0.11, zc + 0.05, packs[(r() * packs.length) | 0]); x += 0.08; }
    }
  }
}

// Paris: shaker front — a recessed centre panel in a slightly deeper tone inside a ~5.5 cm frame. (cx, y) = centre x and
// bottom of the front, z = its face. Same material for every front → one extra draw call for a whole kitchen.
function shaker(p, m, w, h, cx, y, z, mat, dir = 1) {
  if (m.styleId !== 'paris') return;
  const mg = Math.min(0.055, h * 0.24, w * 0.24);
  if (h - 2 * mg < 0.035 || w - 2 * mg < 0.06) return;
  box(p, w - 2 * mg, h - 2 * mg, 0.003, mat || m.panelIn, cx, y + mg, z + dir * 0.0006);
}
// rectangular moulding frame on a vertical face (4 strips): centre x, y0..y1, face z, strip width sw, thickness th
function mouldFrame(p, mat, cx, y0, y1, w, z, sw = 0.028, th = 0.012) {
  if (w < sw * 3 || y1 - y0 < sw * 3) return;
  box(p, w, sw, th, mat, cx, y0, z); box(p, w, sw, th, mat, cx, y1 - sw, z);
  for (const sx of [-1, 1]) box(p, sw, y1 - y0 - 2 * sw, th, mat, cx + sx * (w / 2 - sw / 2), y0 + sw, z);
}

// ================================================================== LIVING
function sofa(m, o = {}) {
  const L = o.len || 2.3, D = o.depth || 0.98, s = m.fam, g = new THREE.Group();
  const F = m.fabric;
  if (m.styleId === 'paris') {
    // curved (crescent) bouclé sofa: seat and channel-tufted back sweep along an arc that opens towards the room,
    // floating on a recessed antique-brass plinth; burgundy and blush velvet cushions
    const R = 2.9, th = L / R, n = 9, da = th / n, Ds = 0.86, zC = -D / 2 + R, wB = R * da;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) * da - th / 2, rm = R - Ds / 2, sg = grp(g, rm * Math.sin(a), 0, zC - rm * Math.cos(a), -a);
      box(sg, wB * 0.86, 0.06, Ds - 0.2, m.brass, 0, 0, 0);
      rbox(sg, wB + 0.02, 0.2, Ds, 0.04, F, 0, 0.06, 0);
      rbox(sg, wB + 0.02, 0.15, Ds - 0.25, 0.055, F, 0, 0.245, 0.125);
      soft(sg, wB + 0.012, 0.56, 0.25, F, 0, 0.25, -Ds / 2 + 0.125, [-0.07, 0, 0], { e: [0.55, 0.14, 0.45] });
      if (i === 0 || i === n - 1) soft(sg, 0.2, 0.34, Ds - 0.04, F, (i ? 1 : -1) * (wB / 2 - 0.02), 0.25, 0.02, null, { e: [0.5, 0.3, 0.16] });
      if (i === 1) cushion(sg, 0.44, 0.42, 0.14, m.cushionA, 0.02, 0.4, -Ds / 2 + 0.36, 0.1);
      if (i === 2) cushion(sg, 0.38, 0.36, 0.12, m.cushionB, 0.1, 0.4, -Ds / 2 + 0.41, -0.12);
      if (i === n - 2) cushion(sg, 0.44, 0.42, 0.14, m.cushionB, 0, 0.4, -Ds / 2 + 0.36, -0.1);
      if (i === n - 3) cushion(sg, 0.5, 0.28, 0.13, m.cushionA, -0.08, 0.4, -Ds / 2 + 0.42, 0.12);
      if (i === (n >> 1)) soft(sg, 0.5, 0.03, 0.56, m.throw, 0.16, 0.395, 0.14, [0, 0.2, 0], { e: [0.12, 0.6, 0.12], sag: 0.008 });
    }
    g.userData.solidBox = { w: L, d: D + 0.1, h: 0.8, z: 0.05 };
    return g;
  }
  if (m.styleId === 'kyoto') {
    // low Japandi platform sofa: a solid oak plinth that runs past the seat as side tables, low linen cushions
    const P = 0.18, ext = 0.0;
    box(g, L - 0.06, 0.04, D - 0.1, m.woodDark, 0, 0, -0.01);
    box(g, L, P - 0.04, D, m.woodLight, 0, 0.04, 0);
    box(g, L, 0.03, D, m.woodLight, 0, P - 0.03 + 0.0, 0);
    const arm = 0.18; void ext;
    for (const sx of [-1, 1]) rbox(g, arm, 0.26, D - 0.04, 0.05, F, sx * (L / 2 - arm / 2 - 0.02), P, 0);
    rbox(g, L - 2 * arm - 0.04, 0.3, 0.2, 0.06, F, 0, P, -D / 2 + 0.12);
    const seats = L > 2.1 ? 3 : 2, sw = (L - 2 * arm - 0.04) / seats;
    for (let i = 0; i < seats; i++) {
      seatC(g, sw - 0.008, 0.15, D - 0.26, F, -L / 2 + arm + 0.02 + sw * (i + 0.5), P, 0.09);
      backC(g, sw - 0.014, 0.4, 0.18, F, -L / 2 + arm + 0.02 + sw * (i + 0.5), P + 0.12, -D / 2 + 0.28, [-0.22, 0, 0]);
    }
    cushion(g, 0.44, 0.44, 0.12, m.cushionA, -L / 2 + arm + 0.32, P + 0.2, -D / 2 + 0.42, 0.22);
    cushion(g, 0.4, 0.4, 0.12, m.cushionC, L / 2 - arm - 0.34, P + 0.2, -D / 2 + 0.42, -0.18);
    cushion(g, 0.5, 0.3, 0.11, m.cushionB, L / 2 - arm - 0.72, P + 0.18, -D / 2 + 0.44, -0.05);
    add(g, clothGeo(arm + 0.02, -0.3, 0.2, P + 0.26, 0.22, 0.05, 3, 0.012), m.throw, L / 2 - arm / 2 - 0.02, 0, 0.06);
    g.userData.solidBox = { w: L, d: D, h: 0.62 };
    return g;
  }
  if (s === 'milano') {
    box(g, L - 0.12, 0.07, D - 0.12, m.lacquer, 0, 0, 0);
    box(g, L - 0.1, 0.012, D - 0.1, m.brass, 0, 0.07, 0);
    rbox(g, L, 0.2, D, 0.03, F, 0, 0.08, 0);                              // base
    const arm = 0.24, back = 0.24;
    for (const sx of [-1, 1]) soft(g, arm, 0.38, D, F, sx * (L / 2 - arm / 2), 0.25, 0, null, { e: [0.3, 0.22, 0.14] });
    // channel-tufted back: vertical tubes
    const n = Math.max(6, Math.round((L - 2 * arm) / 0.2)), cw = (L - 2 * arm) / n;
    for (let i = 0; i < n; i++) soft(g, cw + 0.004, 0.54, back, F, -L / 2 + arm + cw * (i + 0.5), 0.26, -D / 2 + back / 2, null, { e: [0.55, 0.14, 0.45] });
    const seats = L > 2.1 ? 3 : 2, sw = (L - 2 * arm) / seats;
    for (let i = 0; i < seats; i++) seatC(g, sw - 0.006, 0.17, D - back - 0.01, F, -L / 2 + arm + sw * (i + 0.5), 0.265, back / 2 - 0.005);
    cushion(g, 0.5, 0.5, 0.15, m.cushionA, -L / 2 + arm + 0.32, 0.43, -D / 2 + back + 0.1, 0.25);
    cushion(g, 0.45, 0.45, 0.14, m.cushionB, -L / 2 + arm + 0.72, 0.43, -D / 2 + back + 0.1, -0.1);
    cushion(g, 0.5, 0.5, 0.15, m.cushionC, L / 2 - arm - 0.32, 0.43, -D / 2 + back + 0.1, -0.2);
    cushion(g, 0.3, 0.5, 0.14, m.accentFabric, L / 2 - arm - 0.72, 0.43, -D / 2 + back + 0.08, 0.1);
  } else if (s === 'nordic') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.018, 0.012, 0.16, m.woodLight, sx * (L / 2 - 0.08), 0, sz * (D / 2 - 0.08), 10);
    rbox(g, L, 0.14, D, 0.03, F, 0, 0.16, 0);
    const arm = 0.14;
    for (const sx of [-1, 1]) rbox(g, arm, 0.32, D, 0.05, F, sx * (L / 2 - arm / 2), 0.28, 0);
    rbox(g, L - 2 * arm, 0.32, 0.16, 0.05, F, 0, 0.28, -D / 2 + 0.08);
    const seats = L > 2.1 ? 3 : 2, sw = (L - 2 * arm) / seats;
    for (let i = 0; i < seats; i++) {
      seatC(g, sw - 0.008, 0.16, D - 0.2, F, -L / 2 + arm + sw * (i + 0.5), 0.295, 0.03);
      backC(g, sw - 0.012, 0.44, 0.2, F, -L / 2 + arm + sw * (i + 0.5), 0.43, -D / 2 + 0.2, [-0.18, 0, 0]);
    }
    cushion(g, 0.45, 0.45, 0.13, m.cushionA, -L / 2 + arm + 0.3, 0.46, -D / 2 + 0.36, 0.2);
    cushion(g, 0.45, 0.45, 0.13, m.cushionC, L / 2 - arm - 0.3, 0.46, -D / 2 + 0.36, -0.2);
    cushion(g, 0.4, 0.4, 0.12, m.cushionB, L / 2 - arm - 0.62, 0.46, -D / 2 + 0.38, -0.05);
    // throw draped over the arm
    add(g, clothGeo(arm + 0.02, -0.28, 0.22, 0.6, 0.3, 0.05, 3, 0.012), m.throw, L / 2 - arm / 2, 0, 0.06);
  } else {
    // riviera: soft rounded bouclé on a recessed wood plinth
    rbox(g, L - 0.2, 0.06, D - 0.2, 0.02, m.woodDark, 0, 0, 0);
    rbox(g, L, 0.26, D, 0.12, F, 0, 0.05, 0, null, 4);
    for (const sx of [-1, 1]) rbox(g, 0.3, 0.42, D, 0.14, F, sx * (L / 2 - 0.15), 0.12, 0, null, 4);
    rbox(g, L - 0.1, 0.5, 0.3, 0.14, F, 0, 0.18, -D / 2 + 0.15, null, 4);
    const seats = 2, sw = (L - 0.6) / seats;
    for (let i = 0; i < seats; i++) seatC(g, sw - 0.006, 0.17, D - 0.33, F, -L / 2 + 0.3 + sw * (i + 0.5), 0.285, 0.14);
    cushion(g, 0.5, 0.5, 0.16, m.cushionA, -L / 2 + 0.55, 0.44, -D / 2 + 0.38, 0.3);
    cushion(g, 0.45, 0.45, 0.15, m.cushionB, -L / 2 + 0.95, 0.44, -D / 2 + 0.38, 0.05);
    cushion(g, 0.5, 0.5, 0.16, m.cushionC, L / 2 - 0.55, 0.44, -D / 2 + 0.38, -0.3);
    const th = grp(g, L / 2 - 0.7, 0, 0.12, 0.2); soft(th, 0.9, 0.035, 0.55, m.throw, 0, 0.45, 0, null, { e: [0.12, 0.6, 0.12], sag: 0.01 });
  }
  g.userData.solidBox = { w: L, d: D, h: 0.8 };
  return g;
}

// ================================================================== SOFA-BED (one-room flats)
// An "accordion" sofa that unfolds into a double bed about 1.6 × 2.0 m. Closed it is a sofa: two arms, a storage /
// head box at the wall, a seat (mattress section 1 on a pull-out drawer) and a back made of mattress sections 2 + 3
// standing folded against the box, loose back cushions, accent cushions, a folded blanket on the seat. Opening: the
// drawer rolls out, sections 2 and 3 unfold flat behind the seat section (a rigid Λ whose head end stays at the box),
// a nested middle frame follows at half the travel, the cushions go into the box; then the back cushions come out
// again to stand at the head, a fitted sheet is drawn over the mattress and two sleeping pillows come out of the box;
// the blanket rides on the seat section and ends at the foot of the bed.
// Origin: floor centre of the CLOSED footprint (L × D), front = +z. The opened bed takes D/2 … D/2 + ext in front.
// Static parts (arms, box, base) are ordinary meshes (baked by apartment.js); everything that moves is under
// userData.sofaBed.dyn: one group per moving part, each holding ONE merged mesh per material.
//   userData.sofaBed = { set(t), dyn, wb, L, D, ext, extW, bedLen, dur }     set(t): pose at t = 0 (sofa) … 1 (bed)
// o.wb: mattress width (1.6 | 1.4); o.static: no kept group — the piece is plain static geometry (cutaway), closed
// unless o.t says otherwise.
const SB = { D: 1.02, BOX: 0.09, T: 0.12, S1: 0.68, S2: 0.64, TOP: 0.42, DUR: 1150 };
const _sbFlat = new WeakMap();
function mergePart(src, name) {
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert(), buckets = new Map(), M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  src.traverse(o => { if (!o.isMesh) return; let b = buckets.get(o.material); if (!b) buckets.set(o.material, b = []); b.push(o); });
  const out = new THREE.Group(); out.name = name || 'part';
  for (const [mat, list] of buckets) {
    let cnt = 0;
    const flats = list.map(o => { let f = _sbFlat.get(o.geometry); if (!f) { f = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; _sbFlat.set(o.geometry, f); } cnt += f.attributes.position.count; return f; });
    const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2);
    let k = 0;
    list.forEach((o, i) => {
      const f = flats[i], P = f.attributes.position, Nn = f.attributes.normal;
      M.multiplyMatrices(inv, o.matrixWorld); N.getNormalMatrix(M);
      for (let j = 0; j < P.count; j++, k++) {
        v.fromBufferAttribute(P, j).applyMatrix4(M);
        if (Nn) n.fromBufferAttribute(Nn, j).applyMatrix3(N).normalize(); else n.set(0, 1, 0);
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z; nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
        // metres, projected along the dominant normal axis (what the bake does for the static pieces)
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        if (ay >= ax && ay >= az) { uv[k * 2] = v.x; uv[k * 2 + 1] = v.z; } else if (ax >= az) { uv[k * 2] = v.z; uv[k * 2 + 1] = v.y; } else { uv[k * 2] = v.x; uv[k * 2 + 1] = v.y; }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(g, mat); mesh.name = (name || 'part') + ':' + (mat.name || '');
    out.add(mesh);
  }
  return out;
}
// a mattress section: w × T × len, top at y = top, from z0 to z0 + len; welted (piped) top and bottom edges
function sbSection(p, w, len, top, z0, F, pipe) {
  const T = SB.T, zc = z0 + len / 2;
  rbox(p, w, T, len, 0.034, F, 0, top - T, zc, null, 3);
  for (const y of [top - 0.017, top - T + 0.017]) {
    for (const sz of [-1, 1]) rod(p, 0.0075, w - 0.05, pipe, 0, y, zc + sz * (len / 2 - 0.004), [0, 0, HALF], 8);
    for (const sx of [-1, 1]) rod(p, 0.0075, len - 0.05, pipe, sx * (w / 2 - 0.004), y, zc, [HALF, 0, 0], 8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sph(p, 0.0085, pipe, sx * (w / 2 - 0.014), y, zc + sz * (len / 2 - 0.014), [1, 1, 1], 8);
  }
}
function sofaBed(m, o = {}) {
  if (o.kind === 'book') return sofaBook(m, o);
  const Wb = o.wb === 1.4 ? 1.4 : 1.6, s = m.fam, id = m.styleId, g = new THREE.Group();
  const { D, BOX, T, S1, S2, TOP } = SB, F = m.fabric;
  const aw = s === 'nordic' ? 0.14 : 0.16;                       // slim arms: the piece must fit a studio wall
  const L = Wb + 0.03 + 2 * aw, ax = Wb / 2 + 0.015 + aw / 2, z0 = -D / 2 + BOX, ZF = D / 2;      // z0: head edge of the mattress; ZF: closed front
  const pipe = id === 'milano' ? m.fabricAccent : id === 'monaco' ? m.cushionA : m.throw;        // welt: cognac leather / gold velvet / a tone of the cloth
  const dark = m.darkPlastic, footM = s === 'milano' || id === 'paris' ? m.brass : s === 'nordic' ? m.woodLight : m.woodDark;
  // ---- static: head / storage box, base, arms
  rbox(g, Wb + 0.028, 0.58, BOX, 0.03, F, 0, 0.04, -D / 2 + BOX / 2);
  box(g, Wb - 0.06, 0.22, ZF - 0.04 - z0, dark, 0, 0.05, (z0 + ZF - 0.04) / 2);
  if (id === 'kyoto') {
    for (const sx of [-1, 1]) { box(g, aw + 0.02, 0.13, D, m.woodLight, sx * ax, 0, 0); rbox(g, aw, 0.42, D - 0.03, 0.05, F, sx * ax, 0.13, 0); }
  } else if (s === 'nordic') {
    for (const sx of [-1, 1]) { rbox(g, aw, 0.5, D, 0.05, F, sx * ax, 0.12, 0); for (const sz of [-1, 1]) cyl(g, 0.022, 0.014, 0.12, m.woodLight, sx * ax, 0, sz * (D / 2 - 0.09), 10); }
  } else if (s === 'milano') {
    for (const sx of [-1, 1]) { box(g, aw - 0.05, 0.07, D - 0.1, m.lacquer, sx * ax, 0, 0); box(g, aw - 0.03, 0.012, D - 0.08, m.brass, sx * ax, 0.07, 0); soft(g, aw, 0.54, D, F, sx * ax, 0.082, 0, null, { e: [0.3, 0.22, 0.14] }); }
  } else {
    for (const sx of [-1, 1]) {
      if (id === 'paris') { for (const sz of [-1, 1]) cyl(g, 0.03, 0.022, 0.08, m.brass, sx * ax, 0, sz * (D / 2 - 0.1), 12); }
      else rbox(g, aw - 0.06, 0.08, D - 0.12, 0.02, m.woodDark, sx * ax, 0, 0);
      rbox(g, aw, 0.52, D, 0.075, F, sx * ax, 0.08, 0, null, 4);
    }
  }
  // ---- moving parts (built in the sofa's frame at the CLOSED pose)
  const tmp = () => new THREE.Group();
  // drawer: front panel, side skirts, deck, feet, mattress section 1 (the seat), the folded blanket
  let t = tmp();
  rbox(t, Wb + 0.02, 0.25, 0.04, 0.014, F, 0, 0.05, ZF - 0.02);
  if (s === 'milano') box(t, Wb + 0.02, 0.012, 0.042, m.brass, 0, 0.038, ZF - 0.021);
  for (const sx of [-1, 1]) {
    box(t, 0.02, 0.2, S1 - 0.04, F, sx * (Wb / 2 - 0.002), 0.1, ZF - 0.04 - (S1 - 0.04) / 2);
    for (const z of [ZF - 0.07, ZF - S1 + 0.06]) cyl(t, s === 'nordic' ? 0.02 : 0.026, s === 'nordic' ? 0.014 : 0.022, 0.05, footM, sx * (Wb / 2 - 0.09), 0, z, 10);
  }
  box(t, Wb - 0.03, 0.03, S1 - 0.07, dark, 0, 0.27, ZF - 0.05 - (S1 - 0.07) / 2);
  sbSection(t, Wb, S1, TOP, z0 + 2 * T, F, pipe);
  { const bx = Wb / 2 - 0.34, bz = ZF - 0.24;
    soft(t, 0.5, 0.05, 0.38, m.throw, bx, TOP - 0.004, bz, null, { e: [0.12, 0.6, 0.12], sag: 0.004 });
    soft(t, 0.48, 0.045, 0.36, m.throw, bx + 0.006, TOP + 0.04, bz - 0.004, [0, 0.05, 0], { e: [0.12, 0.6, 0.12], sag: 0.004 });
    soft(t, 0.5, 0.012, 0.07, pipe, bx, TOP + 0.082, bz + 0.08, [0, 0.05, 0], { e: [0.1, 0.8, 0.3] }); }
  const drawer = mergePart(t, 'sb-drawer');
  // middle frame (nested in the drawer, travels half the way): skirts, deck, feet
  t = tmp();
  for (const sx of [-1, 1]) { box(t, 0.018, 0.17, 0.56, F, sx * (Wb / 2 - 0.036), 0.1, ZF - 0.04 - 0.28); cyl(t, 0.018, 0.018, 0.1, dark, sx * (Wb / 2 - 0.1), 0, ZF - 0.09, 8); }
  box(t, Wb - 0.09, 0.025, 0.56, dark, 0, 0.245, ZF - 0.04 - 0.28);
  const mid = mergePart(t, 'sb-mid');
  // sections 2 and 3 (the back): local frames at their hinges
  t = tmp(); sbSection(t, Wb, S2, 0, -S2, F, pipe);
  const sec2 = mergePart(t, 'sb-sec2');
  t = tmp(); sbSection(t, Wb, S2, T, -S2, F, pipe);
  const sec3 = mergePart(t, 'sb-sec3'); sec3.position.set(0, -T, -S2); sec2.add(sec3);
  // loose back cushions (origin: their bottom line)
  t = tmp();
  for (const sx of [-1, 1]) soft(t, Wb / 2 - 0.03, 0.54, 0.17, F, sx * Wb / 4, 0, 0, null, { e: [0.18, 0.2, 0.55], pinch: 0.18 });
  const backC = mergePart(t, 'sb-back');
  // accent cushions (origin: seat top, in front of the back cushions)
  t = tmp();
  cushion(t, 0.45, 0.45, 0.13, m.cushionA, -Wb / 2 + 0.3, 0.01, 0, 0.22, -0.3);
  cushion(t, 0.4, 0.4, 0.12, s === 'milano' ? m.cushionB : m.cushionC, Wb / 2 - 0.27, 0.01, 0.01, -0.2, -0.3);
  if (Wb > 1.5) cushion(t, 0.46, 0.28, 0.12, m.cushionB, -Wb / 2 + 0.68, 0.01, 0.03, 0.06, -0.32);
  const accC = mergePart(t, 'sb-accent');
  // sleeping pillows (origin: their bottom, between the two)
  t = tmp();
  for (const sx of [-1, 1]) {
    soft(t, Wb / 2 - 0.1, 0.15, 0.44, m.linen, sx * (Wb / 4 - 0.005), 0, 0, [0, sx * 0.05, 0], { e: [0.42, 0.9, 0.42], pinch: 0.62 });
    for (const sz of [-1, 1]) rod(t, 0.005, Wb / 2 - 0.2, pipe, sx * (Wb / 4 - 0.005), 0.075, sz * 0.208, [0, sx * 0.05, HALF], 6);
  }
  const pillows = mergePart(t, 'sb-pillows');
  // fitted sheet (origin: head edge)
  const LB = S1 + 2 * S2;
  t = tmp();
  rbox(t, Wb + 0.018, 0.075, LB + 0.018, 0.034, m.linen, 0, -0.075, (LB + 0.018) / 2, null, 3);
  const sheet = mergePart(t, 'sb-sheet');
  // contact shadow of the pulled-out part
  const sh = new THREE.Group(); sh.name = 'sb-shadow';
  if (m.ao) { const q = fxFlat(sh, m.ao, 'rect', 0, 0.013, 0, 1, 1); q.renderOrder = 2; if (m.aoSoft) { const q2 = fxFlat(sh, m.aoSoft, 'soft', 0, 0.012, 0, 1.5, 1.5); q2.renderOrder = 2; } }
  const dyn = new THREE.Group(); dyn.name = 'sofa-bed';
  dyn.add(drawer, mid, sec2, backC, accC, pillows, sheet, sh);
  g.add(dyn);
  // ---- pose
  const TR = 2 * S2, zC = z0 + 2 * T, cl = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, ss = (a, b, x) => { const k = cl((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const EXT = TR - 2 * T;                                    // travel of the drawer = floor taken in front of the sofa
  const set = (e) => {
    e = cl(e);
    const em = ease(cl(e / 0.74)), th = HALF * (1 - em);
    // the Λ of sections 2 + 3: its head corner stays at the box while it flattens → the drawer's travel follows
    const zs = TR * Math.cos(th) + 2 * T * Math.sin(th) - 2 * T;
    drawer.position.z = zs; mid.position.z = zs / 2; mid.visible = e > 0.001;
    sec2.position.set(0, TOP, zC + zs); sec2.rotation.x = th; sec3.rotation.x = -2 * th;
    // back cushions: into the box behind the back, and out of it again to stand at the head of the bed
    const k1 = ss(0, 0.24, e), k2 = ss(0.62, 0.88, e), kb = e < 0.45 ? 1 - k1 : k2;
    backC.visible = kb > 0.002; backC.scale.setScalar(0.25 + 0.75 * kb);
    if (e < 0.45) { backC.position.set(0, lerp(TOP, 0.52, k1) + 0.34 * Math.sin(Math.PI * k1), lerp(zC + 0.105, z0 - 0.03, k1)); backC.rotation.x = lerp(-0.15, -0.9, k1); }
    else { backC.position.set(0, lerp(0.55, TOP + 0.008, k2) + 0.22 * Math.sin(Math.PI * k2), lerp(z0 - 0.03, z0 + 0.1, k2)); backC.rotation.x = lerp(-0.6, -0.07, k2); }
    const ka = ss(0, 0.24, e), sa = 1 - 0.94 * ka;
    accC.visible = ka < 0.999; accC.scale.setScalar(sa); accC.position.set(0, lerp(TOP, 0.5, ka) + 0.3 * Math.sin(Math.PI * ka), lerp(zC + 0.25, z0 - 0.03, ka));
    const kp = ss(0.7, 0.97, e);
    pillows.visible = kp > 0.001; pillows.scale.setScalar(0.12 + 0.88 * kp); pillows.rotation.x = 0.2 * kp;
    pillows.position.set(0, lerp(0.5, TOP + 0.03, kp) + 0.24 * Math.sin(Math.PI * kp), lerp(z0 - 0.03, z0 + 0.43, kp));
    const ks = ss(0.64, 0.9, e);
    sheet.visible = ks > 0.001; sheet.scale.z = Math.max(0.001, ks); sheet.position.set(0, TOP + 0.008, z0 - 0.009);
    sh.visible = zs > 0.02; sh.position.set(0, 0, ZF + zs / 2); sh.scale.set(Wb + 0.24, 1, Math.max(0.01, zs + 0.2));
  };
  set(o.static && o.t ? o.t : 0);
  if (o.static) { for (const c of dyn.children.slice()) if (!c.visible) dyn.remove(c); }
  else dyn.userData.keep = true;
  g.userData.solidBox = { w: L, d: D, h: 1.06 };
  g.userData.sofaBed = { set, dyn, kind: 'pull', wb: Wb, L, D, ext: EXT, extW: Wb + 0.06, bedLen: LB, bedW: Wb, dur: SB.DUR };
  return g;
}
// The second mechanism, for a room too narrow for the pull-out: a "eurobook" — the bed lies ALONG the wall and takes
// only 0.62 m of floor in front of the sofa. Closed: an armless sofa 1.96 × 1.0 m — a seat (mattress piece 1 on a
// rolling base), a back (mattress piece 2 standing behind the seat), loose back cushions, two bolsters as arms,
// accent cushions, the folded blanket. Opening: the seat rolls out, the back tips forward and comes to lie flat in
// the gap behind it (sleeping surface 1.94 × 1.58 m), the cushions go into the box, the sheet is drawn over, the
// pillows come out at one end. o.wb === 1.4: a lower back → a bed 1.40 m wide that takes only 0.44 m of floor.
// Same userData.sofaBed contract as the pull-out.
const SK = { L: 1.96, D: 1.0, BD: 0.04, T2: 0.16, S: 0.8, H2: 0.78, T: 0.12, TOP: 0.42 };
function sofaBook(m, o = {}) {
  const s = m.fam, id = m.styleId, g = new THREE.Group(), F = m.fabric;
  const { L, D, BD, T2, S, T, TOP } = SK, H2 = o.wb === 1.4 ? 0.6 : SK.H2, zb = -D / 2, ZF = D / 2, EXT = H2 - T2, WB = S + H2;
  const pipe = id === 'milano' ? m.fabricAccent : id === 'monaco' ? m.cushionA : m.throw;
  const dark = m.darkPlastic, footM = s === 'milano' || id === 'paris' ? m.brass : s === 'nordic' ? m.woodLight : m.woodDark;
  // a welted pad lying flat: w × t × len, top at y = top, from z0 to z0 + len
  const pad = (p, w, t, len, top, z0) => {
    const zc = z0 + len / 2;
    rbox(p, w, t, len, 0.034, F, 0, top - t, zc, null, 3);
    for (const y of [top - 0.017, top - t + 0.017]) {
      for (const sz of [-1, 1]) rod(p, 0.0075, w - 0.05, pipe, 0, y, zc + sz * (len / 2 - 0.004), [0, 0, HALF], 8);
      for (const sx of [-1, 1]) rod(p, 0.0075, len - 0.05, pipe, sx * (w / 2 - 0.004), y, zc, [HALF, 0, 0], 8);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) sph(p, 0.0085, pipe, sx * (w / 2 - 0.014), y, zc + sz * (len / 2 - 0.014), [1, 1, 1], 8);
    }
  };
  // ---- static: the board at the wall, the bedding box under the seat, rear feet
  rbox(g, L, 0.58, BD, 0.012, F, 0, 0.04, zb + BD / 2);
  rbox(g, L - 0.06, 0.2, S - 0.2, 0.01, F, 0, 0.06, zb + BD + T2 + (S - 0.2) / 2);
  for (const sx of [-1, 1]) cyl(g, 0.024, 0.02, 0.06, footM, sx * (L / 2 - 0.12), 0, zb + BD + T2 + 0.08, 10);
  if (id === 'kyoto') box(g, L, 0.04, BD + 0.02, m.woodLight, 0, 0, zb + BD / 2 + 0.01);
  // ---- moving parts
  const tmp = () => new THREE.Group();
  // seat unit: front panel, side cheeks, deck, feet, mattress piece 1, the folded blanket
  let t = tmp();
  rbox(t, L, 0.26, 0.04, 0.014, F, 0, 0.04, ZF - 0.02);
  if (s === 'milano') box(t, L, 0.012, 0.042, m.brass, 0, 0.028, ZF - 0.021);
  if (id === 'kyoto') box(t, L, 0.035, 0.05, m.woodLight, 0, 0.005, ZF - 0.02);
  for (const sx of [-1, 1]) {
    box(t, 0.022, 0.22, S - 0.04, F, sx * (L / 2 - 0.011), 0.08, ZF - 0.04 - (S - 0.04) / 2);
    for (const z of [ZF - 0.08, ZF - S + 0.1]) cyl(t, s === 'nordic' ? 0.02 : 0.026, s === 'nordic' ? 0.014 : 0.022, 0.04, footM, sx * (L / 2 - 0.1), 0, z, 10);
  }
  box(t, L - 0.05, 0.03, S - 0.07, dark, 0, 0.27, ZF - 0.05 - (S - 0.07) / 2);
  pad(t, L - 0.012, T, S, TOP, ZF - S);
  { const bx = L / 2 - 0.36, bz = ZF - 0.24;
    soft(t, 0.5, 0.05, 0.38, m.throw, bx, TOP - 0.004, bz, null, { e: [0.12, 0.6, 0.12], sag: 0.004 });
    soft(t, 0.48, 0.045, 0.36, m.throw, bx + 0.006, TOP + 0.04, bz - 0.004, [0, 0.05, 0], { e: [0.12, 0.6, 0.12], sag: 0.004 });
    soft(t, 0.5, 0.012, 0.07, pipe, bx, TOP + 0.082, bz + 0.08, [0, 0.05, 0], { e: [0.1, 0.8, 0.3] }); }
  const seat = mergePart(t, 'sb-seat');
  // the back = mattress piece 2 (local frame: lying flat, its wall-side top edge at the origin)
  t = tmp(); pad(t, L - 0.012, T2, H2, 0, 0);
  const back = mergePart(t, 'sb-backpad');
  // cushions: three back cushions, two bolsters as arms, two accent cushions (origin: seat top at the back)
  t = tmp();
  const cw = (L - 0.08) / 3;
  for (let i = 0; i < 3; i++) soft(t, cw - 0.012, 0.4, 0.17, F, (i - 1) * cw, 0.005, 0.1, [-0.15, 0, 0], { e: [0.18, 0.2, 0.55], pinch: 0.18 });
  for (const sx of [-1, 1]) {
    soft(t, 0.21, 0.2, 0.56, F, sx * (L / 2 - 0.115), 0.004, 0.2 + 0.3, null, { e: [0.85, 0.85, 0.22] });
    for (const sz of [-1, 1]) torus(t, 0.088, 0.006, pipe, sx * (L / 2 - 0.115), 0.104, 0.5 + sz * 0.262, null, Math.PI * 2, 18);
  }
  cushion(t, 0.45, 0.45, 0.13, m.cushionA, -L / 2 + 0.55, 0.012, 0.25, 0.2, -0.3);
  cushion(t, 0.4, 0.4, 0.12, s === 'milano' ? m.cushionB : m.cushionC, L / 2 - 0.52, 0.012, 0.26, -0.18, -0.3);
  const cush = mergePart(t, 'sb-cushions');
  // sleeping pillows at the head end (−x), side by side across the bed (origin: between them, mattress top)
  t = tmp();
  for (const sz of [-1, 1]) {
    soft(t, 0.44, 0.15, WB / 2 - 0.1, m.linen, 0, 0, sz * (WB / 4 - 0.005), [0, sz * 0.04, 0], { e: [0.42, 0.9, 0.42], pinch: 0.62 });
    for (const sx of [-1, 1]) rod(t, 0.005, WB / 2 - 0.2, pipe, sx * 0.208, 0.075, sz * (WB / 4 - 0.005), [HALF, sz * 0.04, 0], 6);
  }
  const pillows = mergePart(t, 'sb-pillows');
  t = tmp();
  rbox(t, L + 0.006, 0.075, WB + 0.018, 0.034, m.linen, 0, -0.075, (WB + 0.018) / 2, null, 3);
  const sheet = mergePart(t, 'sb-sheet');
  const sh = new THREE.Group(); sh.name = 'sb-shadow';
  if (m.ao) { const q = fxFlat(sh, m.ao, 'rect', 0, 0.013, 0, 1, 1); q.renderOrder = 2; if (m.aoSoft) { const q2 = fxFlat(sh, m.aoSoft, 'soft', 0, 0.012, 0, 1.5, 1.5); q2.renderOrder = 2; } }
  const dyn = new THREE.Group(); dyn.name = 'sofa-bed';
  dyn.add(seat, back, cush, pillows, sheet, sh);
  g.add(dyn);
  const cl = x => x < 0 ? 0 : x > 1 ? 1 : x, ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, ss = (a, b, x) => { const k = cl((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const lerp = (a, b, k) => a + (b - a) * k, zP = zb + BD;
  const set = (e) => {
    e = cl(e);
    const es = ease(cl(e / 0.52)), zs = EXT * es;
    seat.position.z = zs;
    // the back tips forward about its lower wall-side edge and rises onto the box as it comes down
    const eb = ease(cl((e - 0.2) / 0.52));
    back.position.set(0, lerp(TOP + T2 - H2 + 0.3, TOP, eb), zP); back.rotation.x = -HALF * (1 - eb);
    const k1 = ss(0, 0.22, e);
    cush.visible = k1 < 0.998; cush.scale.setScalar(1 - 0.85 * k1);
    cush.position.set(0, lerp(TOP, 0.5, k1) + 0.3 * Math.sin(Math.PI * k1), lerp(zP + T2, zb, k1)); cush.rotation.x = -0.5 * k1;
    const kp = ss(0.72, 0.97, e);
    pillows.visible = kp > 0.001; pillows.scale.setScalar(0.12 + 0.88 * kp); pillows.rotation.z = -0.14 * kp;
    pillows.position.set(-L / 2 + 0.28, lerp(0.5, TOP + 0.035, kp) + 0.24 * Math.sin(Math.PI * kp), lerp(zb + 0.02, zP + WB / 2, kp));
    const ks = ss(0.68, 0.92, e);
    sheet.visible = ks > 0.001; sheet.scale.z = Math.max(0.001, ks); sheet.position.set(0, TOP + 0.008, zP - 0.009);
    sh.visible = zs > 0.02; sh.position.set(0, 0, ZF + zs / 2); sh.scale.set(L + 0.2, 1, Math.max(0.01, zs + 0.2));
  };
  set(o.static && o.t ? o.t : 0);
  if (o.static) { for (const c of dyn.children.slice()) if (!c.visible) dyn.remove(c); }
  else dyn.userData.keep = true;
  g.userData.solidBox = { w: L, d: D, h: 0.9 };
  g.userData.sofaBed = { set, dyn, kind: 'book', wb: WB, L, D, ext: EXT, extW: L + 0.02, bedLen: L - 0.012, bedW: WB, dur: SB.DUR };
  return g;
}
// footprint of a sofa-bed for a style (planning, before the piece is built)
function sofaBedSize(m, wb = 1.6, kind = 'pull') {
  if (kind === 'book') return { L: SK.L, D: SK.D, ext: (wb === 1.4 ? 0.6 : SK.H2) - SK.T2, extW: SK.L + 0.02, h: 0.9 };
  const aw = m.fam === 'nordic' ? 0.14 : 0.16; return { L: wb + 0.03 + 2 * aw, D: SB.D, ext: 2 * SB.S2 - 2 * SB.T, extW: wb + 0.06, h: 1.06 };
}

function armchair(m, o = {}) {
  const s = m.fam, g = new THREE.Group();
  if (m.styleId === 'monaco') {
    // Art-Deco tub chair: navy velvet barrel back wrapping a deep seat, on a stepped brass plinth
    cyl(g, 0.33, 0.35, 0.04, m.brass, 0, 0, 0, 40); cyl(g, 0.31, 0.31, 0.06, m.lacquer, 0, 0.04, 0, 40);
    soft(g, 0.72, 0.24, 0.68, m.fabricAccent, 0, 0.1, 0.02, null, { e: [0.55, 0.3, 0.55], seg: 26 });
    const shellG = cg('decoTub', () => new THREE.TorusGeometry(0.33, 0.075, 12, 36, Math.PI * 1.25));
    add(g, shellG, m.fabricAccent, 0, 0.55, -0.02, [HALF, 0, 0.875 * Math.PI], [1, 1, 3.2]);   // arc centred behind the seat
    soft(g, 0.58, 0.15, 0.56, m.fabricAccent, 0, 0.32, 0.04, null, { e: [0.5, 0.45, 0.5], sag: 0.01 });
    for (let i = 0; i < 7; i++) { const a = -Math.PI * 0.62 + i * Math.PI * 0.207; soft(g, 0.1, 0.42, 0.1, m.fabricAccent, Math.sin(a) * 0.3, 0.36, -Math.cos(a) * 0.3 + 0.02, [0, -a, 0], { e: [0.6, 0.18, 0.6], seg: 14 }); }
    cushion(g, 0.38, 0.3, 0.12, m.cushionA, 0, 0.5, -0.1, 0, -0.2);
    g.userData.solidBox = { w: 0.8, d: 0.8, h: 0.8 };
    return g;
  }
  if (m.styleId === 'kyoto') {
    // low lounge chair: solid oak frame with wide flat arms, deep linen seat and back cushions
    const W = 0.78, D = 0.82, oak = m.woodLight;
    for (const sx of [-1, 1]) { box(g, 0.06, 0.5, D, oak, sx * (W / 2 - 0.03), 0, 0); box(g, 0.12, 0.03, D + 0.02, oak, sx * (W / 2 - 0.05), 0.5, 0); }
    box(g, W - 0.12, 0.04, D - 0.1, oak, 0, 0.16, 0.02);
    box(g, W - 0.12, 0.45, 0.04, oak, 0, 0.2, -D / 2 + 0.06, [-0.18, 0, 0]);
    seatC(g, W - 0.13, 0.14, D - 0.16, m.fabric, 0, 0.2, 0.04);
    backC(g, W - 0.14, 0.42, 0.14, m.fabric, 0, 0.32, -D / 2 + 0.16, [-0.2, 0, 0]);
    cushion(g, 0.4, 0.3, 0.11, m.cushionB, 0.05, 0.42, -0.18, 0.1, -0.3);
    add(g, clothGeo(0.13, -0.3, 0.3, 0.53, 0.25, 0.03, 4, 0.006), m.throw, W / 2 - 0.05, 0, 0.0);
    g.userData.solidBox = { w: 0.8, d: 0.84, h: 0.6 };
    return g;
  }
  if (m.styleId === 'paris') {
    // burgundy velvet club chair: rolled arms, a scalloped channel back, piped seat cushion, tapered brass legs
    const A = m.fabricAccent;
    for (const [x, z] of [[-0.31, -0.29], [0.31, -0.29], [-0.31, 0.3], [0.31, 0.3]]) { cyl(g, 0.022, 0.011, 0.17, m.brass, x, 0, z, 12); cyl(g, 0.026, 0.026, 0.012, m.brass, x, 0.158, z, 12); }
    rbox(g, 0.78, 0.15, 0.76, 0.06, A, 0, 0.17, 0, null, 3);
    soft(g, 0.56, 0.16, 0.6, A, 0, 0.29, 0.06, null, { e: [0.3, 0.45, 0.3], sag: 0.014 });
    for (let i = 0; i < 5; i++) soft(g, 0.158, 0.56 + 0.07 * Math.sin((i + 0.5) / 5 * Math.PI), 0.2, A, -0.31 + i * 0.155, 0.3, -0.29, [-0.14, 0, 0], { e: [0.6, 0.16, 0.5], seg: 16 });
    for (const sx of [-1, 1]) { rbox(g, 0.15, 0.24, 0.64, 0.07, A, sx * 0.315, 0.3, 0.03, null, 3); cyl(g, 0.085, 0.085, 0.64, A, sx * 0.325, 0.505, 0.03, 18, [HALF, 0, 0]); }
    cushion(g, 0.4, 0.3, 0.12, m.cushionB, 0, 0.47, -0.13, 0, -0.3);
    g.userData.solidBox = { w: 0.8, d: 0.8, h: 0.8 };
    return g;
  }
  if (s === 'milano') {
    // cognac leather lounge chair, brass sled base
    for (const sx of [-1, 1]) { box(g, 0.02, 0.02, 0.7, m.brass, sx * 0.33, 0, 0); rod(g, 0.01, 0.2, m.brass, sx * 0.33, 0.1, -0.3, [0, 0, 0]); rod(g, 0.01, 0.2, m.brass, sx * 0.33, 0.1, 0.3, [0, 0, 0]); }
    box(g, 0.7, 0.02, 0.66, m.brass, 0, 0.2, 0);
    rbox(g, 0.78, 0.16, 0.8, 0.06, m.fabricAccent, 0, 0.21, 0);
    rbox(g, 0.78, 0.5, 0.18, 0.08, m.fabricAccent, 0, 0.3, -0.33, [-0.2, 0, 0]);
    for (const sx of [-1, 1]) rbox(g, 0.12, 0.26, 0.74, 0.05, m.fabricAccent, sx * 0.34, 0.3, 0);
    cushion(g, 0.42, 0.34, 0.12, m.cushionB, 0, 0.42, -0.18, 0);
  } else if (s === 'nordic') {
    // bouclé shell chair on oak legs
    for (const [x, z] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]]) cyl(g, 0.02, 0.014, 0.24, m.woodLight, x, 0, z, 10);
    rbox(g, 0.76, 0.2, 0.74, 0.09, m.fabricAccent, 0, 0.22, 0, null, 3);
    rbox(g, 0.78, 0.46, 0.22, 0.1, m.fabricAccent, 0, 0.3, -0.28, [-0.12, 0, 0], 3);
    for (const sx of [-1, 1]) rbox(g, 0.16, 0.3, 0.64, 0.07, m.fabricAccent, sx * 0.31, 0.3, 0.02, null, 3);
    box(g, 0.02, 0.4, 0.3, m.throw, 0.4, 0.18, 0.05, [0, 0, 0.1]);
  } else {
    // rattan armchair with linen cushion
    for (const [x, z] of [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]]) rod(g, 0.018, 0.38, m.woodDark, x, 0.19, z, [0, 0, 0], 8);
    box(g, 0.7, 0.05, 0.66, m.cane, 0, 0.36, 0);
    box(g, 0.7, 0.42, 0.04, m.cane, 0, 0.42, -0.33, [-0.12, 0, 0]);
    for (const sx of [-1, 1]) { box(g, 0.04, 0.24, 0.62, m.cane, sx * 0.35, 0.4, 0); rod(g, 0.022, 0.66, m.rattan, sx * 0.35, 0.65, 0, [HALF, 0, 0], 8); }
    rod(g, 0.022, 0.72, m.rattan, 0, 0.86, -0.36, [0, 0, HALF], 8);
    rbox(g, 0.64, 0.1, 0.6, 0.04, m.fabricAccent, 0, 0.41, 0.02);
    cushion(g, 0.44, 0.34, 0.12, m.cushionA, 0, 0.5, -0.22, 0);
  }
  g.userData.solidBox = { w: 0.8, d: 0.8, h: 0.8 };
  return g;
}

function coffeeTable(m, o = {}) {
  const s = m.fam, g = new THREE.Group();
  let top;
  if (m.styleId === 'kyoto') {
    // low travertine plinth table (a solid honed block with a shadow gap) — bonsai, tea set, books
    box(g, 1.0, 0.04, 0.6, m.woodDark, 0, 0, 0);
    rbox(g, 1.12, 0.26, 0.7, 0.01, m.stone, 0, 0.04, 0);
    top = 0.3;
    bookStack(g, m, 2, -0.3, top, 0.1, 5, 0.25);
    bonsai(g, m, 0.22, top, -0.06, 0.34);
    // tea: cast-iron pot + two cups on an oak board
    box(g, 0.3, 0.02, 0.16, m.woodLight, -0.22, top, -0.16);
    lathe(g, [[0, 0], [0.05, 0], [0.065, 0.04], [0.06, 0.08], [0.03, 0.095], [0, 0.1]], m.blackMetal, -0.27, top + 0.02, -0.16, 18);
    for (const dx of [-0.12, -0.07]) lathe(g, [[0, 0], [0.022, 0], [0.028, 0.045], [0.025, 0.045], [0.02, 0.006], [0, 0.006]], m.ceramic, dx + 0.0, top + 0.02, -0.13 - (dx + 0.12) * 0.6, 14);
    g.userData.solidBox = { w: 1.12, d: 0.7, h: 0.32 };
    return g;
  }
  if (m.styleId === 'paris') {
    // round Carrara top with a brass edge on a slender brass cage, smoked-glass lower shelf; books, peonies, candles
    const Rt = 0.5; top = 0.4;
    cyl(g, Rt, Rt, 0.03, m.marble, 0, top - 0.03, 0, 48); torus(g, Rt, 0.007, m.brass, 0, top - 0.032, 0, [HALF, 0, 0], Math.PI * 2, 48);
    torus(g, 0.4, 0.009, m.brass, 0, 0.012, 0, [HALF, 0, 0], Math.PI * 2, 40); torus(g, 0.4, 0.007, m.brass, 0, 0.16, 0, [HALF, 0, 0], Math.PI * 2, 40);
    for (let i = 0; i < 4; i++) { const a = i * HALF + 0.785; rod(g, 0.009, top - 0.03, m.brass, Math.cos(a) * 0.4, (top - 0.03) / 2, Math.sin(a) * 0.4, null, 8); }
    cyl(g, 0.395, 0.395, 0.008, m.smoked, 0, 0.162, 0, 40);
    bookStack(g, m, 3, -0.2, top, 0.05, 5, 0.3); bookStack(g, m, 2, 0.05, 0.17, -0.1, 9, 1.1);
    vase(g, m, 0.18, top, -0.1, 0.2, m.ceramic, true);
    tray(g, m, 0.12, top, 0.24, 0.26, 0.16, m.brass); candle(g, m, 0.07, top + 0.008, 0.24, 0.1); candle(g, m, 0.17, top + 0.008, 0.25, 0.07);
    g.userData.solidBox = { w: 1.0, d: 1.0, h: 0.42 };
    return g;
  }
  if (s === 'milano') {
    cyl(g, 0.22, 0.26, 0.3, m.brass, 0, 0, 0, 28);
    const t = cyl(g, 0.5, 0.5, 0.04, m.marble, 0, 0.3, 0, 40); t.scale.set(1.35, 1, 0.85); top = 0.34;
    const t2 = cyl(g, 0.5, 0.5, 0.01, m.brass, 0, 0.297, 0, 40); t2.scale.set(1.36, 1, 0.86);
  } else if (s === 'nordic') {
    cyl(g, 0.5, 0.5, 0.035, m.woodLight, 0, 0.36, 0, 40); top = 0.395;
    cyl(g, 0.44, 0.44, 0.02, m.woodLight, 0, 0.1, 0, 40);
    for (let i = 0; i < 4; i++) { const a = i * HALF + 0.785; rod(g, 0.018, 0.36, m.blackMetal, Math.cos(a) * 0.36, 0.18, Math.sin(a) * 0.36, [0, 0, 0], 8); }
  } else {
    cyl(g, 0.46, 0.44, 0.34, m.stone, 0, 0, 0, 40); top = 0.34;
    cyl(g, 0.47, 0.47, 0.04, m.stone, 0, 0.3, 0, 40);
  }
  // styling
  bookStack(g, m, 3, -0.18, top, 0.02, 5, 0.3);
  if (s === 'milano') { tray(g, m, 0.22, top, 0.02, 0.36, 0.24); candle(g, m, 0.14, top + 0.008, 0.02, 0.12); candle(g, m, 0.26, top + 0.008, 0.05, 0.08); sph(g, 0.05, m.ceramic2, 0.3, top + 0.06, -0.04, [1, 1, 1], 14); }
  else if (s === 'nordic') { vase(g, m, 0.2, top, -0.05, 0.22, m.ceramic2); bowl(g, m, 0.05, top, 0.22, 0.1, m.ceramic, false); }
  else { bowl(g, m, 0.18, top, 0, 0.13, m.ceramic2, true); vase(g, m, -0.15, top + 0.07, 0.02, 0.2, m.pot2, false); leaf(g, m, 'lance', 0.2, 0.1, -0.15, top + 0.27, 0.02, -0.4, 0.3, 0.2, m.leaf2); leaf(g, m, 'lance', 0.18, 0.09, -0.14, top + 0.27, 0.02, 0.5, 1.8, -0.2, m.leaf2); }
  g.userData.solidBox = { w: s === 'milano' ? 1.35 : 1.0, d: s === 'milano' ? 0.85 : 1.0, h: 0.4 };
  return g;
}

function sideTable(m, o = {}) {
  const g = new THREE.Group(), s = m.fam;
  if (s === 'milano' || m.styleId === 'paris') { cyl(g, 0.2, 0.2, 0.02, m.marble, 0, 0.5, 0, 28); rod(g, 0.02, 0.5, m.brass, 0, 0.25, 0); cyl(g, 0.15, 0.15, 0.015, m.brass, 0, 0, 0, 24); }
  else if (s === 'nordic') { cyl(g, 0.21, 0.21, 0.025, m.woodLight, 0, 0.5, 0, 28); for (let i = 0; i < 3; i++) { const a = i * 2.09; rod(g, 0.012, 0.5, m.blackMetal, Math.cos(a) * 0.15, 0.25, Math.sin(a) * 0.15); } }
  else { cyl(g, 0.2, 0.22, 0.5, m.rattan, 0, 0, 0, 24); cyl(g, 0.21, 0.21, 0.02, m.woodDark, 0, 0.5, 0, 24); }
  if (o.lamp !== false) tableLamp(g, m, 0, 0.52, 0, 0.45);
  g.userData.solidBox = { w: 0.44, d: 0.44, h: 0.55 };
  return g;
}

function tableLamp(p, m, x, y, z, h = 0.5) {
  const s = m.fam, g = grp(p, x, y, z);
  if (m.styleId === 'kyoto') {          // small washi globe on a bronze ring foot
    cyl(g, 0.06, 0.07, 0.015, m.blackMetal, 0, 0, 0, 20); for (let i = 0; i < 3; i++) { const a = i * 2.094; rod(g, 0.004, h * 0.2, m.blackMetal, Math.cos(a) * 0.05, h * 0.1, Math.sin(a) * 0.05, null, 4); }
    washiLantern(g, m, 0, h * 0.2 + h * 0.36, 0, h * 0.18, 1.0);
    fxFlat(g, m.glowFaint, 'disc', 0, 0.003, 0, 0.8, 0.8);
    return g;
  }
  if (s === 'milano') { cyl(g, 0.07, 0.08, 0.02, m.brass, 0, 0, 0, 20); rod(g, 0.008, h * 0.6, m.brass, 0, h * 0.3, 0); cyl(g, 0.1, 0.17, h * 0.4, m.lampShade, 0, h * 0.55, 0, 24, null, true); }
  else if (s === 'nordic') { lathe(g, [[0, 0], [0.06, 0], [0.08, h * 0.25], [0.02, h * 0.5], [0, h * 0.5]], m.ceramic, 0, 0, 0, 20); cyl(g, 0.13, 0.16, h * 0.35, m.lampShade, 0, h * 0.48, 0, 24, null, true); }
  else { lathe(g, [[0, 0], [0.05, 0], [0.11, h * 0.28], [0.05, h * 0.52], [0, h * 0.52]], m.pot, 0, 0, 0, 20); cyl(g, 0.12, 0.17, h * 0.34, m.lampShade, 0, h * 0.5, 0, 24, null, true); }
  sph(g, 0.03, m.bulb, 0, h * 0.62, 0, [1, 1, 1], 8);
  fxFlat(g, m.glowFaint, 'disc', 0, 0.003, 0, 0.75, 0.75);
  bloom(g, 0, h * 0.7, 0, 0.75, 0.55);
  return g;
}

function diningTable(m, o = {}) {
  const L = o.len || 1.8, W = o.width || 0.95, s = m.fam, g = new THREE.Group(), H = 0.76;
  if (m.styleId === 'paris') {
    // Carrara slab on two turned antique-brass pedestals
    rbox(g, L, 0.036, W, 0.014, m.marble, 0, H - 0.036, 0);
    box(g, L - 0.16, 0.012, W - 0.16, m.brass, 0, H - 0.048, 0);
    for (const sx of [-1, 1]) {
      lathe(g, [[0.001, 0], [0.24, 0], [0.24, 0.02], [0.1, 0.045], [0.05, 0.1], [0.06, 0.2], [0.04, 0.36], [0.055, 0.5], [0.045, H - 0.14], [0.12, H - 0.06], [0.14, H - 0.048], [0.001, H - 0.048]], m.brass, sx * L * 0.27, 0, 0, 28);
    }
    vase(g, m, 0, H, 0, 0.26, m.ceramic, true); candle(g, m, -0.3, H, 0.03, 0.2); candle(g, m, 0.3, H, -0.03, 0.16);
    g.userData.solidBox = { w: L, d: W, h: H };
    return g;
  }
  if (s === 'milano') {
    rbox(g, L, 0.035, W, 0.012, m.marble, 0, H - 0.035, 0);
    for (const sx of [-1, 1]) { box(g, 0.1, H - 0.035, W * 0.55, m.woodDark, sx * L * 0.3, 0, 0); box(g, 0.12, 0.012, W * 0.58, m.brass, sx * L * 0.3, 0, 0); }
    box(g, L * 0.6, 0.06, 0.08, m.woodDark, 0, H - 0.1, 0);
  } else if (s === 'nordic') {
    rbox(g, L, 0.04, W, 0.01, m.woodLight, 0, H - 0.04, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.028, 0.022, H - 0.04, m.woodLight, sx * (L / 2 - 0.12), 0, sz * (W / 2 - 0.1), 12);
    box(g, L - 0.3, 0.07, 0.025, m.woodLight, 0, H - 0.11, W / 2 - 0.1); box(g, L - 0.3, 0.07, 0.025, m.woodLight, 0, H - 0.11, -W / 2 + 0.1);
  } else {
    rbox(g, L, 0.05, W, 0.02, m.stone, 0, H - 0.05, 0);
    for (const sx of [-1, 1]) { box(g, 0.12, H - 0.05, W * 0.62, m.stone, sx * L * 0.3, 0, 0); }
  }
  // centrepiece
  const cz = 0;
  if (s === 'milano') { candle(g, m, -0.12, H, cz, 0.22); candle(g, m, 0.12, H, cz, 0.18); bowl(g, m, 0.35, H, cz, 0.13, m.ceramic2, true); }
  else if (s === 'nordic') { vase(g, m, 0, H, cz, 0.28, m.ceramic); candle(g, m, 0.25, H, 0.04, 0.12); }
  else { bowl(g, m, 0, H, cz, 0.16, m.ceramic2, true); vase(g, m, -0.35, H, cz, 0.24, m.pot, true); glass(g, m, 0.35, H, 0.05, 'tumbler'); }
  g.userData.solidBox = { w: L, d: W, h: H };
  return g;
}

function tableSetting(m, o = {}) { const g = new THREE.Group(); placeSetting(g, m, 0, o.y ?? 0, 0, 0); g.userData.noSolid = true; return g; }

function diningChair(m, o = {}) {
  const s = m.fam, g = new THREE.Group(), SH = 0.46;
  if (m.styleId === 'paris') {
    // Louis XVI medallion chair: cream-painted frame, fluted tapered legs, blush velvet seat and oval back
    const fr = m.lacquer2, up = m.accentFabric;
    for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.2], [0.2, 0.2]]) { cyl(g, 0.02, 0.011, SH - 0.08, fr, x, 0, z, 10); box(g, 0.045, 0.05, 0.045, fr, x, SH - 0.085, z); }
    rbox(g, 0.44, 0.045, 0.43, 0.015, fr, 0, SH - 0.08, 0.005);
    soft(g, 0.45, 0.1, 0.44, up, 0, SH - 0.05, 0.008, null, { e: [0.35, 0.5, 0.35], sag: 0.006 });
    for (const sx of [-1, 1]) rod(g, 0.013, 0.2, fr, sx * 0.13, SH + 0.07, -0.198, [-0.12, 0, 0], 8);
    torus(g, 0.195, 0.018, fr, 0, SH + 0.385, -0.235, [-0.12, 0, 0], Math.PI * 2, 32).scale.set(1, 1.14, 1);
    soft(g, 0.37, 0.43, 0.065, up, 0, SH + 0.17, -0.235, [-0.12, 0, 0], { e: [1, 1, 0.7], seg: 20 });
    g.userData.noSolid = true; g.userData.ao = { w: 0.62, d: 0.6 };
    return g;
  }
  if (s === 'milano') {
    // cognac-leather tub chair: tapered dark legs, a padded seat and a curved wrap-around back shell
    for (const [x, z] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.19], [0.19, 0.19]]) cyl(g, 0.017, 0.011, SH - 0.05, m.woodDark, x, 0, z, 10, [z * 0.25, 0, -x * 0.25]);
    soft(g, 0.5, 0.1, 0.48, m.fabricAccent, 0, SH - 0.08, 0.02, null, { e: [0.2, 0.5, 0.2], sag: 0.008 });
    const shell = cg('chairShell', () => new THREE.TorusGeometry(0.235, 0.032, 10, 28, Math.PI * 1.15));
    add(g, shell, m.fabricAccent, 0, SH + 0.17, 0.0, [-HALF, 0, -0.075 * Math.PI], [1.02, 1, 4.2]);
    soft(g, 0.4, 0.26, 0.06, m.fabricAccent, 0, SH + 0.06, -0.19, [-0.12, 0, 0], { e: [0.25, 0.3, 0.6], pinch: 0.2 });
  } else if (s === 'nordic') {
    const wd = m.styleId === 'kyoto' ? m.woodDark : m.woodLight;     // kyoto: smoked-oak wishbone chairs
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) cyl(g, 0.017, 0.014, SH, wd, x, 0, z, 10);
    box(g, 0.44, 0.02, 0.42, m.rattan, 0, SH - 0.02, 0);
    box(g, 0.46, 0.03, 0.44, wd, 0, SH - 0.05, 0);
    for (const sx of [-1, 1]) rod(g, 0.015, 0.34, wd, sx * 0.2, SH + 0.15, -0.2);
    torus(g, 0.22, 0.02, wd, 0, SH + 0.3, -0.12, [HALF, 0, 0], Math.PI, 20);
  } else {
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) cyl(g, 0.018, 0.016, SH, m.woodDark, x, 0, z, 10);
    box(g, 0.46, 0.04, 0.44, m.woodDark, 0, SH - 0.04, 0);
    rbox(g, 0.42, 0.05, 0.4, 0.02, m.fabricAccent, 0, SH, 0.01);
    for (const sx of [-1, 1]) rod(g, 0.017, 0.45, m.woodDark, sx * 0.2, SH + 0.2, -0.21);
    box(g, 0.44, 0.04, 0.03, m.woodDark, 0, SH + 0.4, -0.21);
    box(g, 0.38, 0.3, 0.012, m.cane, 0, SH + 0.1, -0.21);
  }
  g.userData.noSolid = true; g.userData.ao = { w: 0.62, d: 0.6 };
  return g;
}
function stool(m, o = {}) {
  const s = m.styleId === 'paris' ? 'milano' : m.fam, g = new THREE.Group(), H = o.h || 0.65;   // paris: brass legs, velvet seat
  const legM = s === 'nordic' ? m.woodLight : s === 'milano' ? m.brass : m.woodDark;
  for (let i = 0; i < 4; i++) { const a = i * HALF + 0.785; rod(g, 0.012, H, legM, Math.cos(a) * 0.15, H / 2, Math.sin(a) * 0.15, [Math.sin(a) * 0.06, 0, -Math.cos(a) * 0.06], 8); }
  torus(g, 0.16, 0.008, legM, 0, H * 0.3, 0, [HALF, 0, 0]);
  rbox(g, 0.38, 0.06, 0.36, 0.025, s === 'riviera' ? m.cane : m.fabricAccent, 0, H, 0);
  rbox(g, 0.36, 0.14, 0.04, 0.015, s === 'riviera' ? m.cane : m.fabricAccent, 0, H + 0.08, -0.17);
  g.userData.noSolid = true; g.userData.ao = { w: 0.5, d: 0.5, cell: 'disc' };
  return g;
}

// Low cabinet body (tv unit / sideboard): hollow carcass between yB and yT with finished ends, interior veneer,
// dividers per pair of doors, optional mid shelf. Returns the bay list [{x, w}] and the interior planes.
function lowCarcass(g, m, L, D, yB, yT, body, zFront, shelf = false) {
  const inM = m.cabinetIn, T = 0.018, ib = -D / 2 + 0.016, dI = zFront - ib, zc = (ib + zFront) / 2;
  box(g, L - 0.036, yT - yB, 0.016, inM, 0, yB, -D / 2 + 0.008);
  for (const sx of [-1, 1]) box(g, T, yT - yB, D - 0.006, body, sx * (L / 2 - T / 2), yB, -0.003);
  box(g, L - 0.036, T, dI, inM, 0, yB, zc); box(g, L - 0.036, T, dI, inM, 0, yT - T, zc);
  return { inM, T, ib, dI, zc, y0: yB + T, y1: yT - T, shelf };
}
// Hinged doors in pairs over n equal fronts; returns [{x0, x1}] bays and creates one lazily-filled compartment.
function lowDoors(g, m, C, L, n, yDoor, hDoor, zBack, faceFn, fill) {
  const dw = L / n, bays = [];
  for (let i = 0; i < n; i += 2) bays.push({ x0: -L / 2 + i * dw + (i ? 0.009 : 0.018), x1: -L / 2 + Math.min(n, i + 2) * dw - (i + 2 < n ? 0.009 : 0.018) });
  for (let k = 1; k < bays.length; k++) box(g, C.T, C.y1 - C.y0, C.dI - 0.01, C.inM, -L / 2 + 2 * k * dw, C.y0, C.zc - 0.005);
  if (C.shelf) for (const b of bays) box(g, b.x1 - b.x0, C.T, C.dI - 0.03, C.inM, (b.x0 + b.x1) / 2, (C.y0 + C.y1) / 2, C.zc - 0.015);
  const comp = compartment(g, (c) => bays.forEach((b, i) => { fill(c, b, i); ledWash(c, m, (b.x0 + b.x1) / 2, b.x1 - b.x0, C.y0, C.y1, C.ib, zBack); }));
  for (let i = 0; i < n; i++) {
    const a = -L / 2 + i * dw, side = i % 2 === 0 && i !== n - 1 ? -1 : 1;
    const mv = hinged(g, a + 0.003, a + dw - 0.003, yDoor, zBack, side, comp);
    faceFn(mv, i, mv.userData.cx, dw - 0.006, hDoor, side);
  }
  return bays;
}
function tvUnit(m, o = {}) {
  const L = o.len || 2.0, s = m.fam, g = new THREE.Group(), H = 0.45, D = 0.42;
  box(g, L - 0.1, 0.06, D - 0.08, m.darkPlastic, 0, 0, -0.02);
  const body = s === 'nordic' ? m.woodLight : s === 'milano' ? m.woodDark : m.lacquer2;
  const zB = D / 2 - 0.005, C = lowCarcass(g, m, L, D, 0.06, H, body, zB);
  const n = Math.max(3, Math.round(L / 0.5));
  lowDoors(g, m, C, L, n, 0.063, H - 0.066, zB, (mv, i, cx, w, h) => {
    if (s === 'riviera') { box(mv, w, h, 0.012, m.lacquer2, cx, 0, 0.006); box(mv, w - 0.05, h - 0.06, 0.004, m.cane, cx, 0.03, 0.014); }
    else box(mv, w, h, 0.012, s === 'milano' && i % 2 ? m.lacquer : body, cx, 0, 0.006);
    if (s === 'milano') box(mv, 0.12, 0.008, 0.01, m.brass, cx, h - 0.04, 0.017);
  }, (c, b, i) => {
    // media / games / books
    const x0 = b.x0 + 0.02, x1 = b.x1 - 0.02, y = C.y0, W = (WEAR[m.styleId] || WEAR[s]), k = i % 3;
    if (k === 0) {
      const cols = ['#b8322a', '#1f4e79', '#2f5d3a', '#e6c35a', '#efe6d4', '#6b3b24'];
      let yy = y; for (let j = 0; j < 4; j++) { const h = 0.045 + (j % 2) * 0.02; gameBox(c, m, x0 + 0.2, yy, C.zc + 0.02, 0.36 - j * 0.02, h, 0.26 - j * 0.015, cols[(j + i) % cols.length], (j - 1.5) * 0.04); yy += h; }
      bookRow(c, m, x0 + 0.42, Math.max(0.05, x1 - x0 - 0.42), y, C.zc + 0.03, 71 + i, 0.24);
    } else if (k === 1) {
      bookRow(c, m, x0, (x1 - x0) * 0.6, y, C.zc + 0.03, 83 + i, 0.26);
      bookStack(c, m, 3, x1 - 0.17, y, C.zc + 0.02, 9 + i, 0.1);
    } else {
      cbox(c, 0.3, 0.06, 0.24, '#141414', m.goods, x0 + 0.18, y, C.zc);                       // console / receiver
      cbox(c, 0.26, 0.002, 0.004, '#dcdcdc', m.goods, x0 + 0.18, y + 0.035, C.zc + 0.12);
      let yy = y; for (let j = 0; j < 3; j++) { yy = foldStack(c, m, x1 - 0.2, yy, C.zc + 0.03, 1, 40 + j + i, 0.32, 0.26, [W.boxes[j % 4]]); }   // photo albums
    }
  });
  box(g, L + 0.02, 0.025, D + 0.02, s === 'milano' || m.styleId === 'paris' ? m.marble : body, 0, H, 0);
  // styling on top
  const T = H + 0.025;
  bookStack(g, m, 2, -L / 2 + 0.3, T, 0, 8, 0.1);
  vase(g, m, -L / 2 + 0.3, T + 0.05, 0, 0.26, s === 'milano' ? m.ceramic2 : m.pot2, s !== 'milano');
  if (s === 'milano') { sph(g, 0.09, m.brass, L / 2 - 0.25, T + 0.09, 0, [1, 1, 1], 18); candle(g, m, L / 2 - 0.45, T, 0.04, 0.1); }
  else if (s === 'nordic') { lathe(g, [[0, 0], [0.06, 0], [0.08, 0.1], [0.04, 0.24], [0.045, 0.28], [0, 0.28]], m.ceramic2, L / 2 - 0.3, T, 0, 20); }
  else { bowl(g, m, L / 2 - 0.3, T, 0, 0.12, m.pot, false); lathe(g, [[0, 0], [0.05, 0], [0.09, 0.12], [0.03, 0.3], [0.04, 0.33], [0, 0.33]], m.pot, L / 2 - 0.55, T, 0, 20); }
  g.userData.solidBox = { w: L, d: D, h: 0.5 };
  return g;
}
// Wall TV, bottom edge at y = 0, back on the wall side (-z). o.live: the screen is a separate (unbaked) mesh flagged
// userData.tvScreen that apartment.js switches on (animated picture + a cool spill on the wall) and off on tap.
function tv(m, o = {}) {
  const W = o.w || 1.45, H = W * 0.565, g = new THREE.Group();
  box(g, W, H, 0.025, m.darkPlastic, 0, 0, 0);
  box(g, W * 0.4, H * 0.4, 0.06, m.darkPlastic, 0, H * 0.3, -0.04);            // wall bracket
  if (!o.live) { box(g, W - 0.01, H - 0.01, 0.004, m.screen, 0, 0.005, 0.0135); g.userData.noSolid = true; return g; }
  const scr = new THREE.Mesh(cg('tvScreen', () => new THREE.PlaneGeometry(1, 1)), m.tvLive);
  scr.scale.set(W - 0.012, H - 0.012, 1); scr.position.set(0, H / 2, 0.0131);
  scr.userData.keep = true; scr.userData.tvScreen = { w: W, h: H }; scr.name = 'tv-screen';
  g.add(scr);
  // light the picture throws on the wall around the set (a child: it stays with the screen, out of the bake)
  const gl = new THREE.Mesh(fxGeo('disc'), m.tvGlow);
  gl.position.set(0, 0, o.glowZ ?? -0.043); gl.scale.set(2.3, 2.5, 1); gl.raycast = () => {}; gl.name = 'tv-glow'; gl.renderOrder = 3;
  scr.add(gl);
  g.userData.noSolid = true;
  return g;
}

function bookshelf(m, o = {}) {
  const W = o.w || 1.2, H = o.h || 2.0, D = 0.34, s = m.fam, g = new THREE.Group();
  const fm = s === 'nordic' ? m.woodLight : s === 'milano' ? m.woodDark : m.woodDark;
  const sm = s === 'milano' ? m.brass : fm;
  const shelves = Math.max(4, Math.round(H / 0.38));
  for (const sx of [-1, 1]) box(g, 0.03, H, D, s === 'nordic' ? m.blackMetal : fm, sx * (W / 2 - 0.015), 0, 0);
  if (s !== 'nordic') box(g, W, H, 0.02, fm, 0, 0, -D / 2 + 0.01);
  for (let i = 0; i <= shelves; i++) {
    const y = i * (H - 0.03) / shelves;
    box(g, W - 0.06, 0.028, D, i === 0 ? fm : (s === 'nordic' ? m.woodLight : fm), 0, y, 0);
    if (s === 'milano' && i > 0) box(g, W - 0.06, 0.006, 0.006, m.brass, 0, y + 0.028, D / 2);
    if (i === shelves) continue;
    const top = y + 0.028, avail = (H - 0.03) / shelves - 0.06;
    const r = rngF(i * 17 + 3 + (W * 10 | 0));
    const mode = (i + (W > 1 ? 1 : 0)) % 3;
    if (mode === 0) { const e = bookRow(g, m, -W / 2 + 0.05, W * 0.55, top, 0.02, i * 7 + 1, Math.min(0.3, avail)); vase(g, m, e + 0.12, top, 0, Math.min(0.22, avail), i % 2 ? m.ceramic2 : m.ceramic, false); }
    else if (mode === 1) { bookStack(g, m, 4, -W / 2 + 0.2, top, 0, i * 5); sph(g, 0.06, i % 2 ? m.ceramic : m.ceramic2, 0.0, top + 0.06, 0, [1, 1, 1], 14); bookRow(g, m, W / 2 - 0.4, 0.34, top, 0.02, i * 9, Math.min(0.28, avail)); }
    else { bookRow(g, m, -W / 2 + 0.05, 0.3, top, 0.02, i * 11 + 2, Math.min(0.26, avail)); plantSmall(g, m, 0.12, top, 0, Math.min(0.3, avail), r() * 3); }
  }
  g.userData.solidBox = { w: W, d: D, h: H };
  return g;
}

function sideboard(m, o = {}) {
  const L = o.len || 1.8, D = 0.45, H = o.h || 0.8, s = m.fam, g = new THREE.Group();
  const body = s === 'nordic' ? m.woodLight : s === 'milano' ? m.lacquer : m.lacquer2;
  if (s === 'milano') for (const sx of [-1, 1]) box(g, 0.03, 0.12, D - 0.06, m.brass, sx * (L / 2 - 0.08), 0, 0);
  else for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.02, 0.015, 0.14, s === 'nordic' ? m.blackMetal : m.styleId === 'paris' ? m.brass : m.woodDark, sx * (L / 2 - 0.08), 0, sz * (D / 2 - 0.06), 8);
  const zB = D / 2 - 0.004, C = lowCarcass(g, m, L, D, 0.14, H, body, zB, true);
  const n = Math.max(2, Math.round(L / 0.45));
  lowDoors(g, m, C, L, n, 0.145, H - 0.15, zB, (mv, i, cx, w, h, side) => {
    if (s === 'riviera') { box(mv, w, h, 0.01, m.lacquer2, cx, 0, 0.005); box(mv, w - 0.04, h - 0.04, 0.004, m.cane, cx, 0.02, 0.012); }
    else box(mv, w, h, 0.01, s === 'milano' ? m.woodDark : body, cx, 0, 0.005);
    box(mv, 0.012, 0.18, 0.02, m.metal, cx - side * (w / 2 - 0.047), H * 0.5 - 0.145 - 0.09 + 0.09, 0.015);
  }, (c, b, i) => {
    // upper shelf: glassware; base: plates & serving bowls / bottles
    const x0 = b.x0 + 0.03, x1 = b.x1 - 0.03, ym = (C.y0 + C.y1) / 2 + C.T;
    let x = x0 + 0.05;
    while (x < x1 - 0.04) { wineGlass(c, m, x, ym, C.zc - 0.06); wineGlass(c, m, x, ym, C.zc + 0.06); tumbler(c, m, x + 0.05, ym, C.zc, true); x += 0.1; }
    if (i % 2 === 0) {
      plateStack(c, m, x0 + 0.15, C.y0, C.zc, 8, 0.14, m.porcelain); bowlStack(c, m, x0 + 0.42, C.y0, C.zc, 4, 0.11, s === 'nordic' ? m.ceramic2 : m.ceramic);
      if (x1 - x0 > 0.62) lathe(c, [[0, 0], [0.07, 0], [0.09, 0.08], [0.05, 0.2], [0.025, 0.26], [0.03, 0.3], [0, 0.3]], m.crystal, x1 - 0.1, C.y0, C.zc, 18);   // decanter
    } else {
      const cols = ['#1f3a24', '#4a0710', '#b39a2a', '#2b2b2e'];
      for (let j = 0, xx = x0 + 0.06; xx < x1 - 0.05; j++, xx += 0.1) bottle(c, m, xx, C.y0, C.zc + (j % 2 ? 0.05 : -0.04), j % 3 === 2 ? m.crystal : m.food, 0.3, 0.037, cols[j % 4]);
    }
  });
  box(g, L + 0.02, 0.02, D + 0.02, s === 'milano' || m.styleId === 'paris' ? m.marble : body, 0, H, 0);
  const T = H + 0.02;
  tableLamp(g, m, -L / 2 + 0.25, T, 0, 0.55);
  bookStack(g, m, 3, 0.05, T, 0, 21, 0.2);
  vase(g, m, L / 2 - 0.25, T, 0, 0.34, s === 'milano' ? m.ceramic2 : m.pot2, true);
  g.userData.solidBox = { w: L, d: D, h: H };
  return g;
}

// ================================================================== BEDROOM
function bed(m, o = {}) {
  if (m.styleId === 'kyoto') return lowBed(m, o);
  const W = o.w || 1.6, L = (o.len || 2.0) + 0.05, s = m.fam, g = new THREE.Group();   // o.len: mattress length (2.0; 1.9 in the tightest bedrooms)
  const paris = m.styleId === 'paris';
  const frameM = s === 'milano' || paris ? m.headboard : s === 'nordic' ? m.woodLight : m.woodDark;
  // base
  if (s === 'nordic') { for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.025, 0.02, 0.18, m.woodLight, sx * (W / 2), 0, sz * (L / 2 - 0.1) + 0.03, 10); box(g, W + 0.06, 0.12, L, m.woodLight, 0, 0.16, 0.03); }
  else { box(g, W - 0.1, 0.08, L - 0.1, m.darkPlastic, 0, 0, 0.03); rbox(g, W + 0.08, 0.26, L + 0.04, 0.03, frameM, 0, 0.06, 0.03); }
  const top = s === 'nordic' ? 0.28 : 0.32;
  rbox(g, W, 0.22, L - 0.04, 0.05, m.linen, 0, top, 0.04);                       // mattress
  // duvet: a draped cloth (rolls over the sides and the foot, hangs in folds), turned down at the head end
  // (o.tuck: the duvet ends at the foot of the frame; o.flat: a thin wall-hung headboard — the compact bed of a tight room)
  const dy = top + 0.26, Wc = W + 0.11, zH = -L * 0.2 + 0.08, zF = L / 2 + (o.tuck ? -0.04 : 0.065);
  add(g, clothGeo(Wc, zH, zF, dy, 0.25, 0.07, 1), m.duvet);
  soft(g, Wc + 0.02, 0.085, 0.34, m.duvet, 0, dy - 0.045, zH + 0.1, null, { e: [0.14, 0.7, 0.5], sag: 0.006 });   // turned-down fold
  // bed runner across the foot, draped on top of the duvet
  add(g, clothGeo(Wc, L / 2 - 0.62, zF, dy, 0.3, 0.07, 1, 0.012, zH), m.throw);
  // pillows
  const pz = -L / 2 + 0.2;
  for (const sx of [-1, 1]) {
    cushion(g, W / 2 - 0.06, 0.4, 0.16, m.linen, sx * W / 4, top + 0.2, pz, 0, -0.55);
    cushion(g, W / 2 - 0.12, 0.36, 0.15, m.linen, sx * W / 4, top + 0.24, pz + 0.12, 0, -0.35);
    cushion(g, 0.42, 0.42, 0.13, sx < 0 ? m.cushionA : m.cushionB, sx * 0.24, top + 0.26, pz + 0.26, sx * -0.1, -0.25);
  }
  cushion(g, 0.4, 0.22, 0.14, m.cushionC, 0, top + 0.26, pz + 0.36, 0, -0.2);
  // headboard
  const hz = -L / 2 - 0.02;
  if (o.flat) {
    const hm = s === 'milano' || paris ? m.headboard : s === 'nordic' ? m.woodLight : m.woodDark;
    box(g, W + 0.1, 1.0, 0.026, hm, 0, 0.14, -L / 2 - 0.002);
    if (s === 'nordic') rbox(g, W - 0.12, 0.46, 0.03, 0.012, m.headboard, 0, 0.56, -L / 2 + 0.012);
    else if (s === 'milano') box(g, W + 0.1, 0.012, 0.03, m.brass, 0, 1.14, -L / 2 - 0.002);
    else if (!paris) box(g, W - 0.06, 0.8, 0.008, m.cane, 0, 0.26, -L / 2 + 0.014);
  } else if (s === 'milano') {
    const n = Math.round((W + 0.6) / 0.16), cw = (W + 0.6) / n;
    for (let i = 0; i < n; i++) rbox(g, cw - 0.006, 1.2, 0.1, 0.045, m.headboard, -(W + 0.6) / 2 + cw * (i + 0.5), 0.1, hz);
    box(g, W + 0.64, 0.015, 0.12, m.brass, 0, 1.3, hz);
  } else if (paris) {
    // camel-back headboard in blush velvet: vertical channels rising to a soft arch, brass feet
    const HW = W + 0.36, n = Math.round(HW / 0.15), cw = HW / n;
    for (let i = 0; i < n; i++) { const q = (i + 0.5) / n; rbox(g, cw - 0.005, 1.02 + 0.3 * Math.sin(q * Math.PI), 0.11, 0.05, m.headboard, -HW / 2 + cw * (i + 0.5), 0.08, hz); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.03, 0.022, 0.07, m.brass, sx * (W / 2 - 0.04), 0, 0.03 + sz * (L / 2 - 0.1), 12);
  } else if (s === 'nordic') {
    box(g, W + 0.1, 0.9, 0.05, m.woodLight, 0, 0.2, hz);
    rbox(g, W - 0.1, 0.5, 0.08, 0.04, m.headboard, 0, 0.55, hz + 0.05);
  } else {
    box(g, W + 0.14, 1.15, 0.06, m.woodDark, 0, 0.1, hz);
    box(g, W - 0.04, 0.85, 0.02, m.cane, 0, 0.3, hz + 0.035);
    rod(g, 0.03, W + 0.2, m.woodDark, 0, 1.26, hz, [0, 0, HALF]);
  }
  g.userData.solidBox = { w: W + 0.2, d: L + 0.1, h: 0.6, z: -0.0 };
  return g;
}
// Kyoto: a low oak platform bed (wide surround to sit on), mattress just above knee-low, a slatted oak headboard
// panel with a linen-wrapped cushion rail, a folded throw.
function lowBed(m, o = {}) {
  const W = o.w || 1.6, L = (o.len || 2.0) + 0.05, g = new THREE.Group(), SUR = o.slim ? 0.1 : 0.44;   // (slim: between the towers of a bridge unit)
  box(g, W + (o.slim ? 0 : 0.2), 0.06, L - 0.1, m.woodDark, 0, 0, 0.05);          // recessed shadow plinth
  box(g, W + SUR, 0.12, L + (o.slim ? 0.06 : 0.16), m.woodLight, 0, 0.06, o.slim ? 0.03 : 0.06);   // platform surround
  const top = 0.18;
  rbox(g, W, 0.2, L - 0.04, 0.05, m.linen, 0, top, 0.04);
  const dy = top + 0.24, Wc = W + 0.08, zH = -L * 0.2 + 0.08, zF = L / 2 + 0.06;
  add(g, clothGeo(Wc, zH, zF, dy, 0.2, 0.06, 2), m.duvet);
  soft(g, Wc + 0.02, 0.08, 0.32, m.duvet, 0, dy - 0.04, zH + 0.1, null, { e: [0.14, 0.7, 0.5], sag: 0.006 });
  soft(g, W * 0.9, 0.06, 0.5, m.throw, 0, dy - 0.01, L / 2 - 0.35, null, { e: [0.1, 0.7, 0.2], sag: 0.004 });   // folded throw at the foot
  const pz = -L / 2 + 0.2;
  for (const sx of [-1, 1]) {
    cushion(g, W / 2 - 0.06, 0.38, 0.15, m.linen, sx * W / 4, top + 0.2, pz, 0, -0.6);
    cushion(g, 0.4, 0.4, 0.12, sx < 0 ? m.cushionA : m.cushionB, sx * 0.25, top + 0.24, pz + 0.18, sx * -0.1, -0.3);
  }
  // headboard: oak slats on a dark backing, with a padded linen rail
  const hz = o.flat ? -L / 2 + 0.012 : -L / 2 - 0.05, HW = W + SUR, n = Math.round(HW / 0.07);
  box(g, HW, 0.95, 0.03, m.woodDark, 0, 0.18, hz);
  for (let i = 0; i < n; i++) box(g, 0.04, 0.95, 0.03, m.woodLight, -HW / 2 + (i + 0.5) * HW / n, 0.18, hz + 0.03);
  rbox(g, W - 0.1, 0.22, 0.09, 0.04, m.headboard, 0, top + 0.28, hz + 0.08);
  g.userData.solidBox = { w: W + SUR, d: L + 0.16, h: 0.45, z: 0.06 };
  return g;
}
// Bedside drawer contents (drawer-box floor at y = 0, box centred on x, depth along -z from the front)
function bedsideFill(p, m, w, d, seed) {
  const r = rngM(seed), pal = (BOOKCOL[m.styleId] || BOOKCOL[m.fam]), W = (WEAR[m.styleId] || WEAR[m.fam]);
  add(p, bookGeo(0.15, 0.024, 0.21, pal[(r() * pal.length) | 0]), m.books, -w * 0.2, 0.012, -d * 0.45, [0, 0.12, 0]);
  add(p, bookGeo(0.13, 0.018, 0.19, pal[(r() * pal.length) | 0]), m.books, -w * 0.18, 0.036, -d * 0.47, [0, -0.1, 0]);
  tint(soft(p, 0.16, 0.035, 0.065, m.goods, w * 0.22, 0, -d * 0.25, [0, 0.3, 0], { e: [0.3, 0.5, 0.5], seg: 12 }), W.bags[1]);   // glasses case
  cbox(p, 0.1, 0.012, 0.14, W.boxes[0], m.goods, w * 0.2, 0, -d * 0.7, [0, -0.2, 0]);                                        // notebook
  rod(p, 0.004, 0.13, m.brass, w * 0.2, 0.017, -d * 0.7, [HALF, 0, 0.3], 6);                                               // pen
  toiletry(p, m, w * 0.33, 0, -d * 0.45, W.bags[2], 'jar');
  cbox(p, 0.05, 0.02, 0.05, '#f2f0ec', m.goods, -w * 0.05, 0, -d * 0.18);                                                  // charger
}
function nightstand(m, o = {}) {
  const s = m.fam, g = new THREE.Group(), W = o.w || 0.48, H = 0.5, D = 0.4, inM = m.cabinetIn;
  // body built around a drawer cavity (walls, not a solid block) so the drawer can slide out
  const cavity = (body, yc0, yc1, yTop) => {
    box(g, W, yc0 - body[0], D, body[1], 0, body[0], 0);
    box(g, W, yTop - yc1, D, body[1], 0, yc1, 0);
    for (const sx of [-1, 1]) box(g, 0.02, yc1 - yc0, D - 0.01, body[1], sx * (W / 2 - 0.01), yc0, -0.005);
    box(g, W - 0.04, yc1 - yc0, 0.016, inM, 0, yc0, -D / 2 + 0.008);
  };
  const drawer = (y, h, front, handleFn) => {
    const dr = drawerMv(g, 0, y, D / 2 - 0.005, 0.27);
    box(dr, W - (s === 'nordic' ? 0.04 : 0.02), h, 0.01, front, 0, 0, 0.005);
    if (handleFn) handleFn(dr);
    const bw = W - 0.07, bd = D - 0.05, bh = h - 0.035;
    box(dr, bw, 0.008, bd, inM, 0, 0.012, -bd / 2);
    for (const sx of [-1, 1]) box(dr, 0.01, bh, bd, inM, sx * (bw / 2 - 0.005), 0.012, -bd / 2);
    box(dr, bw, bh, 0.01, inM, 0, 0.012, -bd + 0.005);
    const c = grp(dr, 0, 0.02, -0.01); bedsideFill(c, m, bw - 0.02, bd - 0.02, 13 + (o.seed || 0));
  };
  if (m.styleId === 'paris') {
    // cream-painted bedside on slim brass legs: one panelled drawer with a brass knob, Carrara top
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.014, 0.01, 0.2, m.brass, sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.04), 10);
    cavity([0.2, m.lacquer2], 0.29, 0.47, H);
    drawer(0.3, 0.16, m.lacquer2, dr => { box(dr, W - 0.12, 0.09, 0.003, m.cane, 0, 0.035, 0.0112); sph(dr, 0.014, m.brass, 0, 0.08, 0.024, [1, 1, 0.8], 10); });
    box(g, W + 0.01, 0.02, D + 0.01, m.marble, 0, H, 0);
  } else if (s === 'milano') {
    box(g, W - 0.1, 0.1, D - 0.1, m.brass, 0, 0, 0);
    cavity([0.1, m.woodDark], 0.29, 0.47, H);
    drawer(0.3, 0.16, m.lacquer);
    box(g, W + 0.01, 0.02, D + 0.01, m.marble, 0, H, 0);
  } else if (s === 'nordic') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.013, 0.013, 0.16, m.blackMetal, sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.04), 8);
    cavity([0.16, m.woodLight], 0.33, 0.485, H);
    drawer(0.34, 0.14, m.woodLight, dr => rod(dr, 0.006, 0.12, m.blackMetal, 0, 0.08, 0.02, [0, 0, HALF]));
  }
  else { cyl(g, W / 2, W / 2, H, m.rattan, 0, 0, 0, 24); cyl(g, W / 2 + 0.01, W / 2 + 0.01, 0.02, m.woodDark, 0, H - 0.02, 0, 24); }
  const T = s === 'milano' || m.styleId === 'paris' ? H + 0.02 : H;
  tableLamp(g, m, -W * 0.15, T, -0.05, 0.42);
  bookStack(g, m, 2, W * 0.18, T, 0.06, 13 + (o.seed || 0), 0.4);
  if (o.glass !== false) glass(g, m, W * 0.28, T + 0.05, -0.1, 'tumbler');
  g.userData.solidBox = { w: W, d: D, h: 0.55 };
  return g;
}
// Wardrobe: finished end panels, veneered interior with bays (long hanging / double hanging / shelves), top storage
// shelf, rails; hinged pairs of doors (bedrooms) or staggered sliding panels (o.sliding: hall, dressing room).
// Contents (clothes, folded stacks, shoe boxes, bags, shoes) + the interior LED are built on the first opening.
function wardrobe(m, o = {}) {
  const L = o.len || 1.8, H = o.h || 2.45, D = o.d || 0.6, s = m.fam, g = new THREE.Group(), kind = o.kind || 'bed';
  const inM = m.cabinetIn, T = 0.018, ib = -D / 2 + 0.016, iF = D / 2 - 0.02, zc = (ib + iF) / 2, dI = iF - ib;
  const endM = s === 'riviera' ? m.lacquer2 : m.lacquer, railM = s === 'nordic' ? m.blackMetal : m.brass;
  const sliding = !!o.sliding, tall = H > 1.6;
  // o.fitted (V7): built-in joinery — a row of top boxes above the main doors, flush fronts, edge pulls, o.mirror =
  // index of the door that carries a full-height mirror, o.ceil = gap to the ceiling closed by a scribe panel
  const fit = !!o.fitted && tall;
  // carcass
  box(g, L - 0.012, H, 0.016, inM, 0, 0, -D / 2 + 0.008);
  for (const sx of [-1, 1]) { box(g, 0.006, H, D - 0.02, endM, sx * (L / 2 - 0.003), 0, -0.01); box(g, T, H, dI, inM, sx * (L / 2 - 0.006 - T / 2), 0, zc); }
  box(g, L - 0.012, T, dI, inM, 0, H - T, zc);
  // (V7, cutaway / dollhouse: the cut top reads as a wardrobe from above — a wood cap with the hanging rail drawn on it)
  if (!tall) { box(g, L, 0.006, D, s === 'nordic' ? m.woodLight : m.woodDark, 0, H, 0); box(g, L - 0.12, 0.005, 0.022, railM, 0, H + 0.006, 0); }
  box(g, L - 0.02, 0.06, D - 0.08, m.darkPlastic, 0, 0, -0.03);
  box(g, L - 0.012, T, dI, inM, 0, 0.06, zc);
  const y0 = 0.06 + T, yT = H - T, xin = L / 2 - 0.006 - T;
  // doors → bays
  const nDoor = sliding ? Math.max(2, Math.round(L / 0.95)) : Math.max(2, Math.round(L / 0.5)), dw = L / nDoor;
  const bays = [];
  if (sliding) for (let i = 0; i < nDoor; i++) bays.push([-L / 2 + i * dw, -L / 2 + (i + 1) * dw]);
  else for (let i = 0; i < nDoor; i += 2) bays.push([-L / 2 + i * dw, -L / 2 + Math.min(nDoor, i + 2) * dw]);
  bays.forEach(b => { b[0] = Math.max(b[0], -xin); b[1] = Math.min(b[1], xin); });
  for (let i = 1; i < bays.length; i++) box(g, T, yT - y0, dI - 0.01, inM, bays[i][0], y0, zc - 0.005);
  const seq = D < 0.5 ? ['shelves'] : kind === 'hall' ? ['coat', 'shelves', 'coat'] : ['double', 'shelves', 'long'];   // (a shallow one: shelves only)
  const shelfY = H - 0.42;
  const plan = bays.map(([a, b], i) => {
    const w = b - a - (i ? T / 2 : 0) - (i < bays.length - 1 ? T / 2 : 0), x = (a + b) / 2;
    const type = !tall ? 'low' : seq[(i + (o.seed || 0)) % seq.length];
    const bay = { x, w, type, rails: [], shelves: [] };
    if (tall) { box(g, w, T, dI - 0.02, inM, x, shelfY, zc - 0.01); bay.shelves.push(shelfY + T); }
    if (type === 'coat' || type === 'long') bay.rails.push(shelfY - 0.06);
    else if (type === 'double') { bay.rails.push(shelfY - 0.06, Math.min(1.08, shelfY * 0.52)); }
    else {
      const top = tall ? shelfY : yT, n = Math.max(1, Math.round((top - y0) / 0.34));
      for (let k = 1; k < n; k++) { const yy = y0 + k * (top - y0) / n; box(g, w, T, dI - 0.02, inM, x, yy, zc - 0.01); bay.shelves.push(yy + T); }
    }
    for (const ry of bay.rails) { rod(g, 0.011, w, railM, x, ry, zc, [0, 0, HALF], 12); for (const sx of [-1, 1]) box(g, 0.012, 0.03, 0.03, railM, x + sx * (w / 2 - 0.006), ry - 0.012, zc); }
    return bay;
  });
  const comp = tall ? compartment(g, (c) => {
    const W = (WEAR[m.styleId] || WEAR[s]);
    plan.forEach((bay, i) => {
      const { x, w, type } = bay, x0 = x - w / 2 + 0.01, x1 = x + w / 2 - 0.01, seed = i * 31 + ((L * 100) | 0) + (o.seed || 0) * 7;
      const r = rngM(seed);
      if (type === 'coat') hangRail(c, m, x0, x1, bay.rails[0], zc, seed, ['coat', 'jacket', 'coat', 'shirt'], bay.rails[0] - y0 - 0.32);
      if (type === 'long') hangRail(c, m, x0, x1, bay.rails[0], zc, seed, ['dress', 'dress', 'coat', 'jacket'], bay.rails[0] - y0 - 0.3);
      if (type === 'double') { hangRail(c, m, x0, x1, bay.rails[0], zc, seed, ['shirt', 'shirt', 'jacket', 'shirt'], bay.rails[0] - bay.rails[1] - 0.12); hangRail(c, m, x0, x1, bay.rails[1], zc, seed + 5, ['trousers'], 0.55); }
      if (type === 'coat' || type === 'long' || type === 'double') {       // shoes on the base
        const kinds = kind === 'hall' ? ['sneaker', 'loafer', 'sneaker'] : type === 'long' ? ['heel', 'loafer', 'heel'] : ['loafer', 'sneaker', 'loafer'];
        for (let k = 0, xx = x0 + 0.13; xx < x1 - 0.12; k++, xx += 0.25) shoePair(c, m, xx, y0, zc + 0.08, k % 3 === 1 ? W.bags[0] : W.bags[(k * 3 + i) % W.bags.length], kinds[k % 3], (r() - 0.5) * 0.2);
      }
      if (type === 'shelves') {
        bay.shelves.slice(1).forEach((yy, k) => {
          if (k === 0 && kind !== 'hall') { for (let xx = x0 + 0.18; xx < x1 - 0.16; xx += 0.36) shoeBox(c, m, xx, yy - 0.002, zc + 0.02, W.boxes[(k + xx * 10 | 0) % W.boxes.length]); }
          else if (k === bay.shelves.length - 2 && w > 0.5) { handbag(c, m, x - w * 0.22, yy, zc + 0.03, W.bags[(i + k) % 4], 0.2); handbag(c, m, x + w * 0.22, yy, zc + 0.03, W.bags[(i + k + 1) % 4], -0.15, 0.85); }
          else { const n = w > 0.6 ? 2 : 1; for (let j = 0; j < n; j++) foldStack(c, m, x0 + (j + 0.5) * (x1 - x0) / n, yy, zc + 0.04, 4 + (r() * 3 | 0), seed + k * 5 + j, Math.min(0.3, (x1 - x0) / n - 0.04)); }
        });
        if (kind === 'hall') for (let k = 0, xx = x0 + 0.13; xx < x1 - 0.12; k++, xx += 0.25) shoePair(c, m, xx, y0, zc + 0.06, W.bags[(k + 1) % W.bags.length], k % 2 ? 'loafer' : 'sneaker');
      }
      // top storage: boxes and a bag above the shelf
      const yt = bay.shelves[0];
      if (yt && yT - yt > 0.2) {
        let xx = x0 + 0.02;
        while (xx < x1 - 0.3) { const bw = 0.34; shoeBox(c, m, xx + bw / 2, yt, zc, W.boxes[((xx * 7) | 0) % W.boxes.length], bw, Math.min(0.24, yT - yt - 0.05), 0.3); xx += bw + 0.03; }
        if (x1 - xx > 0.2) handbag(c, m, (xx + x1) / 2, yt, zc + 0.04, W.bags[i % 4], 0.3, 0.8);
      }
      ledWash(c, m, x, w, y0, yt || yT, ib, iF);
    });
  }) : null;
  // doors
  const doorFace = (p, i, cx, w, h, top) => {
    if (fit) {
      const fm = s === 'riviera' ? m.lacquer2 : s === 'milano' && !top && i % 3 === 1 ? m.woodDark : m.lacquer;
      box(p, w, h, 0.02, fm, cx, 0, 0.01);
      if (!top && o.mirror === i) box(p, w - 0.03, h - 0.03, 0.004, m.mirror, cx, 0.015, 0.0215);
      else if (s === 'riviera' && h > 0.5 && w > 0.3) box(p, w - 0.114, h - 0.114, 0.006, m.cane, cx, 0.057, 0.023);
      return;
    }
    if (s === 'riviera') {
      box(p, w, h, 0.02, m.lacquer2, cx, 0, 0.01);
      box(p, w - 0.114, H * 0.62, 0.006, m.cane, cx, H * 0.3 - 0.05, 0.023);
      if (m.styleId === 'paris' && H > 1.6) box(p, w - 0.114, H * 0.3 - 0.05 - 0.13, 0.006, m.cane, cx, 0.07, 0.023);     // lower panel
    } else box(p, w, h, 0.02, s === 'milano' ? (i % 3 === 1 ? m.woodDark : m.lacquer) : m.lacquer, cx, 0, 0.01);
  };
  // top boxes of the fitted version: a pair of flush push-to-open doors per bay, from the storage shelf to the top
  const topRow = (z) => {
    const y = shelfY + T / 2 + 0.003, h = H - 0.008 - y;
    bays.forEach(([a, b], k) => {
      const n = b - a > 0.75 ? 2 : 1, w = (b - a) / n;
      for (let j = 0; j < n; j++) {
        const x0 = a + j * w, side = n === 1 ? (k % 2 ? 1 : -1) : j ? 1 : -1;
        const mv = hinged(g, x0 + 0.003, x0 + w - 0.003, y, z, side, comp);
        doorFace(mv, k * 2 + j, mv.userData.cx, w - 0.006, h, true);
      }
    });
  };
  if (sliding) {
    const yTr = fit ? shelfY - 0.02 : H - 0.03, hP = fit ? shelfY - 0.09 : H - 0.1;
    box(g, L - 0.012, 0.03, 0.07, fit ? endM : m.darkPlastic, 0, yTr, iF + 0.035);
    for (let i = 0; i < nDoor; i++) {
      const xc = -L / 2 + dw * (i + 0.5), front = i % 2, dir = i < (nDoor - 1) / 2 || (nDoor % 2 && i === (nDoor - 1) / 2) ? 1 : -1;
      const mv = mover(g, xc, 0.05, iF + (front ? 0.026 : 0.002), { type: 'slide', dir: [dir, 0, 0], dist: dw - 0.03, comp, excl: 'w' + g.id, dur: 800 });
      doorFace(mv, i, 0, dw + 0.012, hP);
      const px = -dir * (dw / 2 - 0.04);                     // pull on the trailing edge (hook it, slide the panel away)
      if (s === 'riviera') box(mv, 0.022, 0.5, 0.018, m.styleId === 'paris' ? m.brass : m.woodDark, px, Math.min(1.05, H * 0.5) - 0.3, 0.029);
      else box(mv, 0.012, Math.min(0.7, H * 0.4), 0.02, s === 'nordic' && fit ? m.blackMetal : m.metal, px, Math.min(0.75, H * 0.33), 0.03);
    }
    if (fit) topRow(iF + 0.026);
  } else {
    const hD = fit ? shelfY + T / 2 - 0.003 - 0.05 : H - 0.06;
    for (let i = 0; i < nDoor; i++) {
      const a = -L / 2 + i * dw, side = i % 2 === 0 && i !== nDoor - 1 ? -1 : 1;
      const mv = hinged(g, a + 0.003, a + dw - 0.003, 0.05, iF, side, comp), cx = mv.userData.cx, w = dw - 0.006, open = cx - side * (w / 2);
      doorFace(mv, i, cx, w, hD);
      const hx = open + side * (s === 'riviera' ? 0.06 : 0.04);
      if (s === 'riviera') sph(mv, 0.018, m.styleId === 'paris' ? m.brass : m.woodDark, hx, Math.min(1.05, H * 0.5) - 0.05, 0.03, [1, 1, 0.6], 10);
      else if (s === 'milano') box(mv, 0.012, Math.min(0.6, H * 0.35), 0.02, m.brass, hx, Math.min(0.8, H * 0.35) - 0.05, 0.03);
      else if (fit) box(mv, 0.012, 0.36, 0.016, m.blackMetal, open + side * 0.03, 0.82, 0.027);
      else box(mv, 0.14, 0.012, 0.012, m.blackMetal, cx, Math.min(1.0, H * 0.5) - 0.05, 0.026);
    }
    if (fit) topRow(iF);
  }
  if (fit && o.ceil > 0.005) box(g, L, o.ceil, 0.018, endM, 0, H, D / 2 - 0.04);       // scribe panel up to the ceiling
  if (s === 'nordic') box(g, L, 0.05, 0.02, m.woodLight, 0, 0, D / 2 - 0.01);
  g.userData.solidBox = { w: L, d: D, h: H };
  return g;
}
function desk(m, o = {}) {
  const L = o.len || 1.2, s = m.fam, g = new THREE.Group(), H = 0.75;
  const top = s === 'nordic' ? m.woodLight : s === 'milano' ? m.woodDark : m.woodDark;
  box(g, L, 0.03, 0.6, top, 0, H - 0.03, 0);
  for (const sx of [-1, 1]) box(g, 0.03, H - 0.03, 0.56, s === 'nordic' ? m.blackMetal : top, sx * (L / 2 - 0.03), 0, 0);
  // laptop, lamp, notebook, mug
  const lp = grp(g, 0.05, H, 0.02);
  box(lp, 0.34, 0.012, 0.24, m.steel, 0, 0, 0);
  const sc = box(lp, 0.34, 0.23, 0.006, m.steel, 0, 0.005, -0.12, [-0.2, 0, 0]);
  box(lp, 0.32, 0.2, 0.002, m.screen, 0, 0.02, -0.113, [-0.2, 0, 0]);
  tableLamp(g, m, -L / 2 + 0.18, H, -0.15, 0.4);
  bookStack(g, m, 2, L / 2 - 0.2, H, -0.1, 31, 0.1);
  lathe(g, [[0, 0], [0.04, 0], [0.042, 0.09], [0.038, 0.09], [0.036, 0.006], [0, 0.006]], m.ceramic2, L / 2 - 0.15, H, 0.15, 16);
  // chair
  const c = diningChair(m); c.position.set(0, 0, 0.45); c.rotation.y = Math.PI; g.add(c);
  g.userData.solidBox = { w: L, d: 0.6, h: H };
  return g;
}

// ================================================================== KITCHEN
function handle(p, m, x, y, z, len = 0.2, vertical = false) {
  const s = m.fam;
  if (s === 'riviera') { sph(p, 0.016, m.brass, x, y, z + 0.014, [1, 1, 0.8], 10); return; }
  // bar pull on two standoffs (a real shadow line between bar and front)
  if (vertical) {
    rod(p, 0.0065, len, m.metal, x, y, z + 0.03, null, 8);
    for (const k of [-1, 1]) box(p, 0.01, 0.01, 0.026, m.metal, x, y + k * (len / 2 - 0.06) - 0.005, z + 0.013);
  } else {
    rod(p, 0.0065, len, m.metal, x, y, z + 0.03, [0, 0, HALF], 8);
    for (const k of [-1, 1]) box(p, 0.01, 0.01, 0.026, m.metal, x + k * (len / 2 - 0.03), y - 0.005, z + 0.013);
  }
}
// Integrated fridge-freezer column (0.6 × 2.3): hinged fridge door with stocked door bins, pull-out freezer drawer,
// white lit interior (glass shelves, crisper drawers) stocked with groceries on the first opening.
function fridge(m, o = {}) {
  const g = new THREE.Group(), W = o.w || 0.6, H = o.h || 2.3, D = 0.62, front = m.lacquer, inM = m.cabinetIn, Li = m.fridgeIn;
  g.userData.piece = 'fridge';
  const zF = D / 2 - 0.02, zB = -D / 2, zc = (zB + 0.016 + zF) / 2, dI = zF - zB - 0.016;
  // tall housing (hollow)
  box(g, W, H, 0.016, inM, 0, 0, zB + 0.008);
  for (const sx of [-1, 1]) box(g, 0.016, H, dI, inM, sx * (W / 2 - 0.008), 0, zc);
  box(g, W - 0.032, 0.016, dI, inM, 0, H - 0.016, zc);
  const yS = H * 0.4 - 0.007, yF0 = H * 0.42 + 0.003;
  box(g, W - 0.01, yF0 - yS, 0.01, m.darkPlastic, 0, yS, zF - 0.03);
  // fridge cavity: white liner, glass shelves with steel trims, crisper drawers
  const Wi = W - 0.07, yb = yF0 + 0.03, yt = H - 0.07, zb = zB + 0.035, zs = zF - 0.13;
  shell(g, Li, Wi + 0.02, yt - yb, zF - 0.005 - zb, 0, yb, (zb + zF - 0.005) / 2, 0.01);
  const shelves = [yb + 0.24, yb + 0.55, yb + 0.86].filter(y => y < yt - 0.2);
  for (const y of shelves) { box(g, Wi, 0.006, zs - zb, m.glass, 0, y, (zb + zs) / 2); box(g, Wi, 0.014, 0.012, m.steel, 0, y - 0.004, zs); }
  for (const sx of [-1, 1]) {
    box(g, Wi / 2 - 0.012, 0.19, 0.012, m.glassFrosted, sx * Wi / 4, yb + 0.02, zs - 0.01);
    box(g, Wi / 2 - 0.012, 0.008, zs - zb - 0.02, Li, sx * Wi / 4, yb + 0.012, (zb + zs) / 2 - 0.01);
    box(g, 0.06, 0.012, 0.006, m.steel, sx * Wi / 4, yb + 0.17, zs - 0.002);
  }
  // freezer cavity
  shell(g, Li, Wi + 0.02, yS - 0.05, zF - 0.005 - zb, 0, 0.03, (zb + zF - 0.005) / 2, 0.01);
  const comp = compartment(g, (c) => {
    const r = rngM(3);
    box(c, Wi - 0.1, 0.012, 0.06, m.coldLed, 0, yt - 0.024, zb + 0.08);
    fxQuad(c, m.coldGlow, 'grad', [0, (yb + yt) / 2, zb + 0.013], [Wi, 0, 0], [0, yt - yb, 0]);
    for (const y of [yb, ...shelves]) fxFlat(c, m.coldGlow, 'grad', 0, y + 0.008, (zb + zs) / 2, Wi, zs - zb);
    // crisper: tomatoes, lemons, apples, peppers, lettuce
    for (let i = 0; i < 5; i++) produce(c, m, -Wi / 4 + (i % 3 - 1) * 0.07, yb + 0.02, zb + 0.08 + (i / 3 | 0) * 0.1 + r() * 0.03, ['tomato', 'tomato', 'pepper', 'tomato', 'pepper'][i]);
    produce(c, m, Wi / 4 - 0.04, yb + 0.02, zb + 0.14, 'lettuce');
    for (let i = 0; i < 4; i++) produce(c, m, Wi / 4 + 0.05 + (i % 2) * 0.06, yb + 0.02, zb + 0.06 + (i >> 1) * 0.07, i % 2 ? 'lemon' : 'apple');
    // shelf 1: milk, juice, eggs, butter
    const y1 = shelves[0] + 0.006;
    pack(c, m, -Wi / 2 + 0.06, y1, zb + 0.1, 0.07, 0.24, 0.07, '#f4f2ee', '#3d6fb6');
    pack(c, m, -Wi / 2 + 0.14, y1, zb + 0.1, 0.07, 0.22, 0.07, '#f2a33a', '#f4efe6');
    eggBox(c, m, 0.07, y1, zb + 0.13);
    cbox(c, 0.1, 0.045, 0.07, FOOD.butter, m.food, Wi / 2 - 0.08, y1, zb + 0.2);
    // shelf 2: glass containers, cheese, jars
    const y2 = (shelves[1] || shelves[0]) + 0.006;
    for (let i = 0; i < 2; i++) { cbox(c, 0.16, 0.07, 0.12, i ? '#8e3b2a' : '#c9a24a', m.food, -Wi / 2 + 0.1 + i * 0.18, y2 + 0.006, zb + 0.12); box(c, 0.18, 0.08, 0.14, m.crystal, -Wi / 2 + 0.1 + i * 0.18, y2, zb + 0.12); box(c, 0.182, 0.012, 0.142, m.darkPlastic, -Wi / 2 + 0.1 + i * 0.18, y2 + 0.08, zb + 0.12); }
    tint(cyl(c, 0.06, 0.06, 0.05, m.food, Wi / 2 - 0.08, y2, zb + 0.1, 20), FOOD.cheese);
    jar(c, m, Wi / 2 - 0.07, y2, zb + 0.24, '#8e1f24', 0.12, 0.04);
    // top: yogurts, a covered bowl, fruit
    const y3 = (shelves[2] || shelves[1] || shelves[0]) + 0.006;
    for (let i = 0; i < 6; i++) { tint(cyl(c, 0.033, 0.03, 0.08, m.goods, -Wi / 2 + 0.05 + (i % 3) * 0.07, y3, zb + 0.08 + (i / 3 | 0) * 0.075, 14), ['#f4f2ee', '#e9b7c4', '#f4f2ee'][i % 3]); cyl(c, 0.034, 0.034, 0.004, m.steel, -Wi / 2 + 0.05 + (i % 3) * 0.07, y3 + 0.08, zb + 0.08 + (i / 3 | 0) * 0.075, 14); }
    bowl(c, m, Wi / 2 - 0.12, y3, zb + 0.14, 0.11, m.ceramic, true);
  });
  // freezer drawer (mover, with its frozen goods)
  const fz = drawerMv(g, 0, 0.003, zF, 0.42);
  box(fz, W - 0.006, yS - 0.01, 0.02, front, 0, 0, 0.01); shaker(fz, m, W - 0.006, yS - 0.01, 0, 0, 0.0205);
  handle(fz, m, W / 2 - 0.05, H * 0.38 - 0.003, 0.02, 0.3, true);
  {
    const bw = Wi - 0.02, bd = zF - zb - 0.06, by = 0.06, bh = yS - 0.16;
    box(fz, bw, 0.008, bd, Li, 0, by, -bd / 2 - 0.02);
    for (const sx of [-1, 1]) box(fz, 0.008, bh, bd, Li, sx * bw / 2, by, -bd / 2 - 0.02);
    box(fz, bw, bh, 0.008, Li, 0, by, -bd - 0.02); box(fz, bw, bh * 0.7, 0.008, m.glassFrosted, 0, by, -0.03);
    const r = rngM(11), cols = ['#2f6db0', '#f4f2ee', '#c8322a', '#6aa84f'];
    for (let i = 0; i < 6; i++) cbox(fz, 0.16, 0.05 + r() * 0.03, 0.12, cols[i % 4], m.goods, -bw / 4 + (i % 2) * bw / 2, by + 0.01 + (i >> 1) * 0.085, -0.12 - r() * 0.05, [0, (r() - 0.5) * 0.2, 0]);
    tint(cyl(fz, 0.07, 0.065, 0.11, m.goods, 0, by + 0.01, -bd + 0.08, 18), '#e9dcc0');
    tint(soft(fz, 0.2, 0.05, 0.14, m.goods, 0.02, by + 0.01, -bd + 0.22, [0, 0.4, 0], { e: [0.3, 0.6, 0.3], seg: 12 }), '#4f8f3a');
  }
  // fridge door (mover): door liner + bins stocked with bottles, jars, eggs
  const dr = hinged(g, -W / 2 + 0.003, W / 2 - 0.003, yF0, zF, -1, comp, { angle: 1.85 }), cx = dr.userData.cx, dh = H - yF0;
  box(dr, W - 0.006, dh, 0.02, front, cx, 0, 0.01); shaker(dr, m, W - 0.006, dh, cx, 0, 0.0205);
  handle(dr, m, cx + W / 2 - 0.05, H * 0.62 - yF0, 0.02, 0.5, true);
  box(dr, W - 0.05, dh - 0.07, 0.03, Li, cx, 0.035, -0.015);
  const bw = W - 0.11, binY = [0.14, dh * 0.45, dh * 0.75];
  binY.forEach((by, bi) => {
    box(dr, bw, 0.008, 0.085, Li, cx, by, -0.072);
    box(dr, bw + 0.012, 0.08, 0.006, m.glassFrosted, cx, by, -0.115);
    for (const sx of [-1, 1]) box(dr, 0.006, 0.08, 0.085, m.glassFrosted, cx + sx * (bw / 2 + 0.003), by, -0.072);
    const y = by + 0.008;
    if (bi === 0) { bottle(dr, m, cx - 0.17, y, -0.072, m.crystal, 0.3, 0.037); bottle(dr, m, cx - 0.09, y, -0.072, m.bottle, 0.32, 0.037); pack(dr, m, cx + 0.02, y, -0.072, 0.075, 0.25, 0.075, '#f4f2ee', '#3d6fb6'); bottle(dr, m, cx + 0.12, y, -0.072, m.food, 0.26, 0.035, '#e8a33c'); }
    else if (bi === 1) { for (let i = 0; i < 3; i++) jar(dr, m, cx - 0.16 + i * 0.1, y, -0.072, ['#8e1f24', '#c9a24a', '#5b7a2a'][i], 0.11, 0.035); toiletry(dr, m, cx + 0.15, y, -0.072, '#c8322a', 'pump', 0.17); }
    else { for (let i = 0; i < 8; i++) tint(sph(dr, 0.021, m.food, cx - 0.16 + i * 0.045, y + 0.03, -0.072, [1, 1.3, 1], 10), FOOD.egg); }
  });
  g.userData.solidBox = { w: W, d: D, h: H };
  return g;
}
// Built-in oven (0.6 × 0.6), origin at the front plane, bottom centre: fixed control fascia, enamel cavity with
// runners, a bottom-hinged glass door; racks, tray and the oven lamp appear on the first opening.
function oven(m, o = {}) {
  const g = new THREE.Group(), W = 0.6;
  g.userData.piece = 'oven';
  box(g, W - 0.01, 0.095, 0.02, m.applianceGlass, 0, 0.5, 0);
  box(g, W - 0.01, 0.09, 0.022, m.steel, 0, 0.5, 0.001);
  for (const x of [-0.2, 0.2]) cyl(g, 0.018, 0.018, 0.02, m.steel, x, 0.545, 0.02, 14, [HALF, 0, 0]);
  box(g, 0.1, 0.025, 0.004, m.led, 0, 0.535, 0.023);
  const cw = 0.48, ch = 0.38, cd = 0.44, cy = 0.07, cz = -0.012;
  box(g, cw, ch, 0.01, m.enamel, 0, cy, cz - cd + 0.005);
  for (const sx of [-1, 1]) { box(g, 0.01, ch, cd, m.enamel, sx * (cw / 2 - 0.005), cy, cz - cd / 2); for (let k = 1; k < 4; k++) rod(g, 0.004, cd - 0.04, m.steel, sx * (cw / 2 - 0.016), cy + k * ch / 4, cz - cd / 2, [HALF, 0, 0], 6); }
  box(g, cw, 0.01, cd, m.enamel, 0, cy, cz - cd / 2); box(g, cw, 0.01, cd, m.enamel, 0, cy + ch - 0.01, cz - cd / 2);
  box(g, W - 0.01, cy, 0.01, m.darkPlastic, 0, 0, cz - 0.004); box(g, W - 0.01, 0.5 - cy - ch, 0.01, m.darkPlastic, 0, cy + ch, cz - 0.004);
  for (const sx of [-1, 1]) box(g, (W - 0.01 - cw) / 2, ch, 0.01, m.darkPlastic, sx * (cw / 2 + (W - 0.01 - cw) / 4), cy, cz - 0.004);
  const comp = compartment(g, (c) => {
    for (const k of [1, 2]) {                                   // wire racks
      const y = cy + k * ch / 4 + 0.006, z = cz - cd / 2;
      for (const sx of [-1, 1]) rod(c, 0.003, cd - 0.05, m.steel, sx * (cw / 2 - 0.03), y, z, [HALF, 0, 0], 5);
      for (let i = 0; i < 13; i++) rod(c, 0.0022, cw - 0.06, m.steel, 0, y, z - cd / 2 + 0.035 + i * (cd - 0.07) / 12, [0, 0, HALF], 4);
    }
    const ty = cy + ch / 4 + 0.01;                              // baking tray with rolls on the lower rack
    box(c, cw - 0.06, 0.006, cd - 0.08, m.enamel, 0, ty, cz - cd / 2); for (const sx of [-1, 1]) box(c, 0.006, 0.02, cd - 0.08, m.enamel, sx * (cw / 2 - 0.033), ty, cz - cd / 2);
    for (let i = 0; i < 6; i++) sph(c, 0.042, m.bread, -0.13 + (i % 3) * 0.13, ty + 0.03, cz - cd / 2 - 0.08 + (i / 3 | 0) * 0.16, [1.3, 0.6, 1], 12);
    lathe(c, [[0, 0], [0.13, 0], [0.15, 0.06], [0.14, 0.06], [0.125, 0.008], [0, 0.008]], m.ceramic2, 0, cy + ch / 2 + 0.008, cz - cd / 2, 22);   // gratin dish
    sph(c, 0.018, m.bulb, cw / 2 - 0.04, cy + ch - 0.04, cz - cd + 0.03, [1, 1, 1], 8);
    fxQuad(c, m.lampGlow, 'lamp', [0, cy + ch / 2, cz - cd + 0.012], [cw * 1.2, 0, 0], [0, ch * 1.3, 0]);
    fxFlat(c, m.glow, 'disc', 0, cy + 0.012, cz - cd / 2, cw, cd);
  });
  const dr = flap(g, 0, 0, -0.01, comp, 1.4);
  box(dr, W - 0.01, 0.495, 0.02, m.applianceGlass, 0, 0, 0.01);
  box(dr, 0.44, 0.34, 0.004, m.darkPlastic, 0, 0.1, 0.021);
  box(dr, 0.46, 0.36, 0.004, m.darkPlastic, 0, 0.08, -0.002);
  rod(dr, 0.009, 0.48, m.steel, 0, 0.47, 0.045, [0, 0, HALF]);
  for (const sx of [-1, 1]) box(dr, 0.012, 0.012, 0.03, m.steel, sx * 0.2, 0.465, 0.03);
  g.userData.noSolid = true;
  return g;
}
// Built-in microwave (0.6 × 0.38): side-hinged glass door, lit cavity with a glass turntable.
function microwave(m, o = {}) {
  const g = new THREE.Group(), W = 0.6, H = 0.38;
  g.userData.piece = 'microwave';
  box(g, 0.1, H, 0.02, m.applianceGlass, W / 2 - 0.055, 0, 0);
  box(g, 0.08, 0.02, 0.004, m.led, 0.245, 0.3, 0.012);
  const cw = 0.4, ch = 0.26, cd = 0.32, cx = -0.06, cy = 0.06, cz = -0.012;
  box(g, cw, ch, 0.01, m.plastic, cx, cy, cz - cd + 0.005);
  for (const sx of [-1, 1]) box(g, 0.01, ch, cd, m.plastic, cx + sx * (cw / 2 - 0.005), cy, cz - cd / 2);
  box(g, cw, 0.01, cd, m.plastic, cx, cy, cz - cd / 2); box(g, cw, 0.01, cd, m.plastic, cx, cy + ch - 0.01, cz - cd / 2);
  box(g, W - 0.11, cy, 0.01, m.darkPlastic, -0.055, 0, cz - 0.004); box(g, W - 0.11, H - cy - ch, 0.01, m.darkPlastic, -0.055, cy + ch, cz - 0.004);
  box(g, 0.045, ch, 0.01, m.darkPlastic, -W / 2 + 0.0275, cy, cz - 0.004); box(g, 0.035, ch, 0.01, m.darkPlastic, cx + cw / 2 + 0.0175, cy, cz - 0.004);
  cyl(g, 0.14, 0.14, 0.006, m.crystal, cx, cy + 0.02, cz - cd / 2, 28);
  const comp = compartment(g, (c) => {
    bowl(c, m, cx, cy + 0.026, cz - cd / 2, 0.09, m.ceramic, false);
    fxQuad(c, m.lampGlow, 'lamp', [cx, cy + ch / 2, cz - cd + 0.012], [cw, 0, 0], [0, ch * 1.2, 0]);
    fxFlat(c, m.glow, 'disc', cx, cy + 0.012, cz - cd / 2, cw * 0.9, cd * 0.9);
  });
  const dr = hinged(g, -W / 2 + 0.005, W / 2 - 0.105, 0, -0.01, -1, comp), dx = dr.userData.cx;
  box(dr, 0.49, H, 0.02, m.applianceGlass, dx, 0, 0.01);
  box(dr, 0.36, 0.26, 0.004, m.darkPlastic, dx - 0.03, 0.06, 0.021);
  box(dr, 0.01, 0.2, 0.02, m.steel, dx + 0.2, 0.09, 0.03);
  g.userData.noSolid = true;
  return g;
}
function hob(m, o = {}) {
  const g = new THREE.Group(), W = o.w || 0.78;
  box(g, W, 0.006, 0.52, m.applianceGlass, 0, 0, 0);
  for (const [x, z, r] of [[-0.2, -0.1, 0.1], [0.2, -0.1, 0.09], [-0.2, 0.14, 0.08], [0.2, 0.14, 0.1]]) torus(g, r, 0.003, m.steel, x, 0.007, z, [HALF, 0, 0], Math.PI * 2, 28);
  box(g, 0.24, 0.001, 0.03, m.steel, 0, 0.007, 0.22);
  g.userData.noSolid = true;
  return g;
}
function hood(m, o = {}) {
  const g = new THREE.Group(), W = o.w || 0.8, s = m.fam, H = o.h || 0.9;
  if (s === 'milano') {
    box(g, W, 0.12, 0.52, m.lacquer, 0, 0, 0);
    box(g, W + 0.004, 0.02, 0.524, m.brass, 0, 0.1, 0);
    box(g, W * 0.45, H - 0.12, 0.34, m.lacquer, 0, 0.12, -0.09);
  } else if (s === 'nordic') {
    cyl(g, 0.22, 0.22, 0.34, m.blackMetal, 0, 0, 0.02, 32);
    rod(g, 0.06, H, m.blackMetal, 0, 0.34 + H / 2, 0.02);
  } else if (m.styleId === 'paris') {
    // French range canopy: white plaster bell with antique-brass bands
    box(g, W + 0.1, 0.07, 0.55, m.moulding, 0, 0, 0);
    const t = cyl(g, 0.2, 0.34, 0.42, m.moulding, 0, 0.07, -0.02, 4); t.rotation.y = Math.PI / 4; t.scale.set(1.35, 1, 0.9);
    box(g, W * 0.5, H - 0.4, 0.4, m.moulding, 0, 0.47, -0.05);
    box(g, W + 0.12, 0.022, 0.57, m.brass, 0, 0.07, 0); box(g, W + 0.11, 0.012, 0.56, m.brass, 0, -0.004, 0);
    box(g, W * 0.5 + 0.02, 0.018, 0.42, m.brass, 0, 0.49, -0.05);
  } else {
    // plaster canopy hood
    const s1 = box(g, W + 0.1, 0.08, 0.55, m.wall, 0, 0, 0);
    const t = cyl(g, 0.2, 0.34, 0.4, m.wall, 0, 0.08, -0.02, 4); t.rotation.y = Math.PI / 4; t.scale.set(1.35, 1, 0.9);
    box(g, W * 0.5, H - 0.4, 0.4, m.wall, 0, 0.46, -0.05);
    box(g, W + 0.12, 0.02, 0.57, m.woodDark, 0, 0.08, 0);
  }
  box(g, W - 0.1, 0.004, 0.2, m.led, 0, -0.003, 0.1);
  g.userData.noSolid = true;
  return g;
}
function dishwasher(m, o = {}) {       // panel-integrated: only a slim steel control strip visible
  const g = new THREE.Group();
  box(g, (o.w || 0.6) - 0.006, 0.02, 0.01, m.steel, 0, 0.72, 0.012);
  box(g, 0.04, 0.006, 0.004, m.led, 0.24, 0.727, 0.018);
  g.userData.noSolid = true;
  return g;
}
// Dishwasher racks: two wire baskets that slide out on their runners once the door has dropped (movers of the
// dishwasher's group). The wirework is part of the mover; the load (plates on edge, cutlery basket, glasses and mugs
// upside down) is a compartment carried by the basket, built on the first opening.
// Local frame: module centre x = 0, tub floor y = 0, front of the tub at z = zf.
function dishRacks(g, m, x, y, w, h, zb, zf, group) {
  const rw = w - 0.06, rd = zf - zb - 0.06, zc = (zb + zf) / 2, wire = m.steel;
  const y1 = 0.06, y2 = Math.min(h * 0.55, 0.42);
  const rack = (p, yy, rh) => {
    for (const sx of [-1, 1]) { rod(p, 0.003, rd, wire, sx * rw / 2, yy, zc, [HALF, 0, 0], 5); rod(p, 0.003, rd, wire, sx * rw / 2, yy + rh, zc, [HALF, 0, 0], 5); }
    for (const sz of [-1, 1]) { rod(p, 0.003, rw, wire, 0, yy, zc + sz * rd / 2, [0, 0, HALF], 5); rod(p, 0.003, rw, wire, 0, yy + rh, zc + sz * rd / 2, [0, 0, HALF], 5); }
    for (let i = 1; i < 9; i++) rod(p, 0.0022, rw, wire, 0, yy, zc - rd / 2 + i * rd / 9, [0, 0, HALF], 4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(p, 0.003, rh, wire, sx * rw / 2, yy + rh / 2, zc + sz * rd / 2, null, 5);
    for (const sx of [-1, 1]) box(p, 0.012, 0.012, rd, m.darkPlastic, sx * (rw / 2 + 0.008), yy - 0.006, zc);      // runner wheels / rails
    box(p, 0.05, 0.012, 0.02, m.darkPlastic, 0, yy + rh, zc + rd / 2 + 0.01);                                      // grip
  };
  // lower basket (slides out further), then the upper one
  const lo = mover(g, x, y, 0, { type: 'slide', dir: [0, 0, 1], dist: Math.min(0.42, rd * 0.8), dur: 650, group, proxy: false, dOpen: 420, dClose: 0, tag: 'dishwasher' });
  rack(lo, y1, 0.1);
  lo.userData.mover.comp = compartment(lo, (c) => {
    for (const [zz, r0] of [[zc - rd * 0.22, 0.125], [zc + rd * 0.08, 0.105]]) for (let xx = -rw / 2 + 0.05; xx < rw / 2 - 0.2; xx += 0.045) { const pg = grp(c, xx, y1 + r0 + 0.012, zz); pg.rotation.z = HALF; plate(pg, m, 0, 0, 0, r0, m.porcelain); }
    const bx = rw / 2 - 0.09, bz = zf - 0.1;
    box(c, 0.12, 0.012, 0.12, m.darkPlastic, bx, y1 + 0.01, bz); for (const sx of [-1, 1]) { box(c, 0.004, 0.11, 0.12, m.darkPlastic, bx + sx * 0.06, y1 + 0.01, bz); box(c, 0.12, 0.11, 0.004, m.darkPlastic, bx, y1 + 0.01, bz + sx * 0.06); }
    for (let i = 0; i < 12; i++) rod(c, 0.0045, 0.19, m.cutlery, bx - 0.045 + (i % 4) * 0.03, y1 + 0.1, bz - 0.04 + (i >> 2) * 0.04, [(i % 3 - 1) * 0.08, 0, (i % 2 - 0.5) * 0.1], 5);
    pot(c, m, -rw / 2 + 0.12, y1 + 0.012, zf - 0.13, 0.09, 0.1, false);
  });
  const up = mover(g, x, y, 0, { type: 'slide', dir: [0, 0, 1], dist: Math.min(0.3, rd * 0.6), dur: 600, group, proxy: false, dOpen: 620, dClose: 0, tag: 'dishwasher' });
  rack(up, y2, 0.08);
  up.userData.mover.comp = compartment(up, (c) => {
    for (let xx = -rw / 2 + 0.06, i = 0; xx < rw / 2 - 0.05; xx += 0.085, i++) {
      tumbler(c, m, xx, y2 + 0.005, zc - rd * 0.25, true);
      if (i % 2) { const wg = grp(c, xx, y2 + 0.215, zc + rd * 0.1); wg.rotation.x = Math.PI; wineGlass(wg, m, 0, 0, 0); }
      else { const mg = grp(c, xx, y2 + 0.095, zc + rd * 0.1); mg.rotation.x = Math.PI; mug(mg, m, 0, 0, 0, i % 4 ? m.ceramic : m.ceramic2, 0.5); }
    }
  });
}
// Under-sink cupboard (lazy): waste bins, cleaning bottles, sponges
function underSink(c, m, w, y, zb, zf) {
  const zc = (zb + zf) / 2;
  cbox(c, 0.22, 0.34, 0.3, m.fam === 'nordic' ? '#e9e7e2' : '#2b2b2c', m.goods, -w / 2 + 0.14, y, zc + 0.04);
  cbox(c, 0.23, 0.02, 0.31, '#8a8d90', m.goods, -w / 2 + 0.14, y + 0.34, zc + 0.04);
  const cols = ['#2f6db0', '#6aa84f', '#f4f2ee', '#e8a33c'];
  for (let i = 0; i < 4; i++) { const x = w / 2 - 0.08 - (i % 2) * 0.09, z = zc + (i < 2 ? 0.08 : -0.05); bottle(c, m, x, y, z, m.goods, 0.24 + (i % 2) * 0.04, 0.035, cols[i]); }
  cbox(c, 0.09, 0.03, 0.06, '#e8c93a', m.goods, w / 2 - 0.12, y, zc - 0.16); cbox(c, 0.09, 0.012, 0.06, '#4f8f3a', m.goods, w / 2 - 0.12, y + 0.03, zc - 0.16);
  ledWash(c, m, 0, w, y, y + 0.55, zb, zf);
}
// Drawer contents (in the drawer's frame: floor y = 0, front z = 0 → back z = -d)
const DFILL = {
  cutlery: (c, m, w, d) => { cutleryTray(c, m, 0, 0, -d / 2, w - 0.01, d - 0.02); },
  crockery: (c, m, w, d, h) => {
    plateStack(c, m, -w / 2 + 0.15, 0, -0.16, 7, 0.135, m.porcelain); plateStack(c, m, -w / 2 + 0.15, 0, -d + 0.15, 7, 0.115, m.ceramic);
    if (w > 0.45) { bowlStack(c, m, w / 2 - 0.11, 0, -0.14, 3, 0.09, m.ceramic2); for (let i = 0; i < 3; i++) mug(c, m, w / 2 - 0.08 - (i % 2) * 0.1, 0, -d + 0.1 + i * 0.1, i % 2 ? m.ceramic2 : m.ceramic, i); }
  },
  pots: (c, m, w, d) => { pot(c, m, -w / 4 + 0.02, 0, -0.14, 0.11, 0.13); pot(c, m, w / 4 - 0.01, 0, -0.13, 0.09, 0.1); if (d > 0.4) pan(c, m, -w / 4 + 0.02, 0, -d + 0.15, 0.12, 0.5); if (w > 0.45) pot(c, m, w / 4, 0, -d + 0.13, 0.1, 0.16); },
  pans: (c, m, w, d) => { pan(c, m, -0.06, 0, -d / 2, 0.14, -0.3); pan(c, m, -0.02, 0.05, -d / 2 - 0.02, 0.12, 0.2); if (w > 0.45) pot(c, m, w / 2 - 0.12, 0, -0.14, 0.09, 0.09, false); },
  // pantry seen from above: cereal / pasta boxes standing in rows, flour bag, jars, tins
  pantry: (c, m, w, d, h, seed) => {
    const r = rngM(seed + 3), packs = ['#b8322a', '#1f4e79', '#e6c35a', '#2f5d3a', '#efe6d4', '#c46a2c', '#6b3b24'], fills = ['#d9a441', '#b0452a', '#ece6d6', '#c2862f'];
    const ph = Math.min(0.26, h - 0.02);
    let x = -w / 2 + 0.02;
    while (x < w / 2 - 0.09) {
      const k = (r() * 3) | 0;
      if (k === 0) { const bw = 0.07 + r() * 0.03; for (let z = -0.04; z > -d + 0.12; z -= 0.2) pack(c, m, x + bw / 2, 0, z - 0.09, bw, ph * (0.75 + r() * 0.25), 0.18, packs[(r() * packs.length) | 0]); x += bw + 0.012; }
      else if (k === 1) { for (let z = -0.06; z > -d + 0.06; z -= 0.11) jar(c, m, x + 0.045, 0, z, fills[(r() * fills.length) | 0], Math.min(0.16, ph), 0.042); x += 0.1; }
      else { for (let z = -0.05; z > -d + 0.06; z -= 0.08) can(c, m, x + 0.036, 0, z, packs[(r() * packs.length) | 0], Math.min(0.11, ph)); x += 0.08; }
    }
  },
  // spice drawer: angled insert with rows of labelled jars lying on their side, lids to the front
  spices: (c, m, w, d) => {
    const cols = ['#b0452a', '#d9a441', '#5f7a2e', '#7a2f2a', '#c2862f', '#3b2418', '#e8c93a', '#8a5a2b'];
    box(c, w - 0.01, 0.012, d - 0.02, m.fam === 'milano' ? m.woodDark : m.woodLight, 0, 0, -d / 2);
    const n = Math.max(3, Math.floor((w - 0.02) / 0.05));
    for (let row = 0; row < Math.floor((d - 0.04) / 0.13); row++) for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.035 + i * (w - 0.04) / n, z = -0.03 - row * 0.13, jg = grp(c, x, 0.033, z - 0.05);
      jg.rotation.x = -HALF + 0.25;
      lathe(jg, [[0, 0], [0.019, 0], [0.019, 0.075], [0.016, 0.08], [0, 0.08]], m.glass, 0, -0.04, 0, 12);
      tint(cyl(jg, 0.016, 0.016, 0.06, m.food, 0, -0.035, 0, 10), cols[(i + row * 3) % cols.length]);
      cyl(jg, 0.0175, 0.0175, 0.018, m.fam === 'nordic' ? m.blackMetal : m.brass, 0, 0.04, 0, 12);
    }
  },
  // utensils: wooden spoons, whisk, ladle, tongs, peeler on a liner
  utensils: (c, m, w, d) => {
    const wd = m.fam === 'milano' ? m.woodDark : m.woodLight;
    for (let i = 0; i < 3; i++) { rod(c, 0.008, 0.26, wd, -w / 2 + 0.06 + i * 0.05, 0.012, -d / 2, [HALF, 0, 0], 8); sph(c, 0.026, wd, -w / 2 + 0.06 + i * 0.05, 0.012, -d / 2 - 0.15, [0.8, 0.35, 1.1], 10); }
    rod(c, 0.006, 0.3, m.steel, w * 0.05, 0.012, -d / 2 + 0.02, [HALF, 0, 0], 8); sph(c, 0.04, m.steel, w * 0.05, 0.02, -d / 2 - 0.17, [1, 0.5, 1], 12);   // ladle
    for (let k = 0; k < 6; k++) torus(c, 0.025, 0.0015, m.steel, w * 0.22, 0.03, -d / 2 - 0.12, [HALF, k * 0.5, 0], Math.PI * 2, 12);                      // whisk
    rod(c, 0.007, 0.13, m.steel, w * 0.22, 0.012, -d / 2 + 0.03, [HALF, 0, 0], 8);
    for (const sx of [-1, 1]) box(c, 0.012, 0.006, 0.26, m.steel, w * 0.38 + sx * 0.012, 0.006, -d / 2, [0, sx * 0.05, 0]);                                     // tongs
  },
  trays: (c, m, w, d) => { for (let i = 0; i < 3; i++) box(c, w - 0.06, 0.012, d - 0.06, i === 1 ? m.steel : m.enamel, 0, i * 0.018, -d / 2); box(c, w * 0.6, 0.02, d * 0.5, m.fam === 'milano' ? m.woodDark : m.woodLight, -w * 0.15, 0.054, -d * 0.3); },
};
// Front-loading washer (o.h: 0.85 freestanding / lower when integrated): real porthole — the front panel is cut
// around a stainless drum, the chrome-rimmed glass door swings open; a few towels tumble inside (lazy).
function washer(m, o = {}) {
  const g = new THREE.Group(), W = 0.6, H = o.h || 0.85, D = o.d || 0.58, pm = m.plastic, zf = D / 2;
  g.userData.piece = 'washer';
  box(g, W, H, 0.02, pm, 0, 0, -D / 2 + 0.01);
  for (const sx of [-1, 1]) box(g, 0.02, H, D, pm, sx * (W / 2 - 0.01), 0, 0);
  box(g, W - 0.04, 0.02, D, pm, 0, H - 0.02, 0);
  const R = Math.min(0.2, (H - 0.2) * 0.34), cy = (H - 0.14) * 0.48 + 0.02;
  const fr = cg(`wfront${r3(H)}|${r3(R)}|${r3(cy)}`, () => {
    const sh = new THREE.Shape(); sh.moveTo(-W / 2 + 0.02, 0); sh.lineTo(W / 2 - 0.02, 0); sh.lineTo(W / 2 - 0.02, H - 0.14); sh.lineTo(-W / 2 + 0.02, H - 0.14); sh.lineTo(-W / 2 + 0.02, 0);
    const hole = new THREE.Path(); hole.absarc(0, cy, R + 0.02, 0, Math.PI * 2, true); sh.holes.push(hole);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false, curveSegments: 36 });
  });
  add(g, fr, pm, 0, 0, zf - 0.02);
  box(g, W, 0.14, 0.02, pm, 0, H - 0.14, zf - 0.02);
  box(g, W - 0.02, 0.1, 0.004, m.darkPlastic, 0, H - 0.12, zf + 0.001);
  cyl(g, 0.022, 0.022, 0.016, m.chrome, W / 2 - 0.1, H - 0.07, zf + 0.004, 16, [HALF, 0, 0]);
  box(g, 0.06, 0.012, 0.003, m.led, -0.12, H - 0.07, zf + 0.004);
  if (o.dryer) { box(g, 0.08, 0.008, 0.003, m.coldLed, -0.12, H - 0.095, zf + 0.004); cbox(g, 0.12, 0.05, 0.004, '#9aa0a6', m.goods, -W / 2 + 0.1, H - 0.115, zf + 0.002); }   // display, condensate drawer
  else cbox(g, 0.14, 0.06, 0.004, '#c8ccd0', m.goods, -W / 2 + 0.1, H - 0.12, zf + 0.002);                                                                        // detergent drawer
  // drum: open lathe along z (double-sided steel), perforated look from the back plate
  add(g, cg(`drum${r3(R)}`, () => new THREE.LatheGeometry([new THREE.Vector2(R + 0.02, 0), new THREE.Vector2(R, -0.025), new THREE.Vector2(R, -D + 0.1), new THREE.Vector2(0.001, -D + 0.08)], 32)), m.drum, 0, cy, zf - 0.02, [HALF, 0, 0]);
  const comp = compartment(g, (c) => {
    // a load of laundry slumped in the drum: shirts, a towel, a sock pair; the dryer holds fluffy towels
    const W2 = (WEAR[m.styleId] || WEAR[m.fam]), r = rngM(o.dryer ? 41 : 17), base = cy - R + 0.012;
    const cols = o.dryer ? ['#f4f1ea', m.fam === 'milano' ? '#2d2b2a' : '#c9b89c', '#e9e3d6'] : [W2.shirts[0], W2.warm[1], W2.dark[1], W2.shirts[2]];
    for (let i = 0; i < (o.dryer ? 4 : 5); i++) {
      const sx = R * (0.7 + r() * 0.5), sy = R * (0.32 + r() * 0.25);
      tint(soft(c, sx, sy, D * (0.3 + r() * 0.2), o.dryer ? m.towel : m.clothes, (r() - 0.5) * R * 0.7, base + i * R * 0.08, zf - D * (0.3 + r() * 0.25), [(r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.5], { e: [0.5, 0.6, 0.5], seg: 12 }), cols[i % cols.length]);
    }
    if (!o.dryer) for (const k of [-1, 1]) tint(soft(c, 0.05, 0.03, 0.16, m.clothes, R * 0.35 + k * 0.03, base + R * 0.45, zf - 0.12, [0.2, 0.6 * k, 0], { e: [0.5, 0.6, 0.5], seg: 8 }), W2.dark[0]);
    fxQuad(c, m.glowFaint, 'disc', [0, cy, zf - D + 0.1], [R * 2.4, 0, 0], [0, R * 2.4, 0]);
    fxFlat(c, m.glowFaint, 'disc', 0, base + 0.01, zf - D * 0.45, R * 1.6, D * 0.7);
  });
  // porthole door: hinge block on the left of the ring
  const dr = mover(g, -R - 0.045, cy, zf, { type: 'hinge', axis: 'y', angle: -1.65, comp, dur: 650 });
  torus(dr, R + 0.012, 0.026, m.chrome, R + 0.045, 0, 0.014, [0, 0, 0], Math.PI * 2, 36);
  torus(dr, R - 0.01, 0.012, m.darkPlastic, R + 0.045, 0, 0.012, [0, 0, 0], Math.PI * 2, 32);
  add(dr, cg(`port${r3(R)}`, () => new THREE.LatheGeometry([[R * 0.98, 0.004], [R * 0.6, -0.035], [0.001, -0.055]].map(([a, b]) => new THREE.Vector2(a, b)), 28)), m.glass, R + 0.045, 0, 0.008, [HALF, 0, 0]);
  box(dr, 0.03, 0.09, 0.03, m.chrome, 0.012, -0.045, 0.012);
  box(dr, 0.02, 0.07, 0.03, m.darkPlastic, 2 * R + 0.07, -0.035, 0.018);
  g.userData.solidBox = { w: 0.6, d: 0.6, h: H };
  return g;
}
// Laundry column: a washer with the dryer stacked on top. o.cabinet: built into a tall cupboard (hall / utility niche)
// with a door pair and a detergent shelf above; otherwise freestanding (utility room) on a stacking kit.
function laundryTower(m, o = {}) {
  const g = new THREE.Group(), H = o.h || 2.6, cab = !!o.cabinet, W = cab ? 0.66 : 0.6, D = cab ? 0.64 : 0.6;
  g.userData.piece = 'laundry';
  const zo = cab ? -0.02 : 0;
  const wm = washer(m, { h: 0.85, d: 0.58 }); wm.position.set(0, cab ? 0.06 : 0, zo); g.add(wm);
  const dr = washer(m, { h: 0.85, d: 0.58, dryer: true }); dr.userData.piece = 'dryer'; dr.position.set(0, (cab ? 0.06 : 0) + 0.87, zo); g.add(dr);
  box(g, 0.6, 0.02, 0.58, m.steel, 0, (cab ? 0.06 : 0) + 0.85, zo);                                        // stacking kit
  if (cab) {
    const inM = m.cabinetIn, zF = D / 2, top = 1.85;
    box(g, W, H, 0.016, inM, 0, 0, -D / 2 + 0.008);
    for (const sx of [-1, 1]) box(g, 0.018, H, D - 0.02, m.lacquer, sx * (W / 2 - 0.009), 0, -0.01);
    box(g, W, 0.018, D - 0.02, inM, 0, H - 0.018, -0.01); box(g, W - 0.036, 0.06, D - 0.06, m.darkPlastic, 0, 0, -0.03);
    box(g, W - 0.036, 0.018, D - 0.04, inM, 0, top, -0.02);
    const comp = compartment(g, (c) => {
      const cols = ['#2f6db0', '#f4f2ee', '#6aa84f', '#e8a33c'];
      for (let i = 0; i < 4; i++) bottle(c, m, -W / 2 + 0.1 + i * 0.12, top + 0.018, -0.05 + (i % 2) * 0.06, m.goods, 0.26 + (i % 2) * 0.04, 0.04, cols[i]);
      for (let i = 0; i < 3; i++) towelRoll(c, m, 0, top + 0.03 + 0.105 * 0 + (i > 1 ? 0.1 : 0), -0.12 + (i % 2) * 0.12, i % 2 ? m.towel2 : m.towel, 0.4);
      ledWash(c, m, 0, W - 0.04, top + 0.018, H - 0.018, -D / 2 + 0.016, zF);
    });
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -W / 2 + 0.002 : 0.001, x1 = side < 0 ? -0.001 : W / 2 - 0.002;
      const mv = hinged(g, x0, x1, 0.065, zF, side, comp), cx = mv.userData.cx, w = x1 - x0;
      box(mv, w, H - 0.07, 0.02, m.lacquer, cx, 0, 0.01); shaker(mv, m, w, H - 0.07, cx, 0, 0.0205);
      handle(mv, m, cx - side * (w / 2 - 0.035), 1.05, 0.02, 0.3, true);
    }
  }
  g.userData.solidBox = { w: W, d: D, h: Math.min(H, 1.9) };
  return g;
}
function sink(m, o = {}) {            // undermount sink + tap, top of counter at y=0 (o.cut: the run cuts a real basin)
  const g = new THREE.Group(), W = o.w || 0.6;
  if (!o.cut) { box(g, W - 0.08, 0.004, 0.38, m.darkPlastic, 0, -0.001, 0.02); box(g, W - 0.1, 0.004, 0.36, m.steel, 0, 0.001, 0.02); }
  tap(g, m, 0, 0, -0.23, 0.36);
  g.userData.noSolid = true;
  return g;
}
function tap(p, m, x, y, z, h = 0.3, mat) {
  const t = mat || m.tap, g = grp(p, x, y, z);
  cyl(g, 0.025, 0.028, 0.03, t, 0, 0, 0, 16);
  rod(g, 0.013, h, t, 0, h / 2, 0);
  torus(g, 0.08, 0.013, t, 0, h, 0.08, [0, HALF, 0], Math.PI, 16);
  rod(g, 0.012, 0.06, t, 0, h - 0.03, 0.16);
  rod(g, 0.007, 0.08, t, 0.03, h * 0.55, 0, [0, 0, -1.1]);
  return g;
}
function coffeeMachine(m, o = {}) {
  const g = new THREE.Group(), s = m.fam;
  const body = s === 'nordic' ? m.plastic : s === 'milano' ? m.steel : m.ceramic;
  rbox(g, 0.28, 0.36, 0.38, 0.03, body, 0, 0, 0);
  box(g, 0.2, 0.02, 0.12, m.steel, 0, 0.02, 0.16);
  box(g, 0.14, 0.1, 0.02, m.darkPlastic, 0, 0.14, 0.19);
  cyl(g, 0.012, 0.012, 0.05, m.steel, 0, 0.09, 0.16, 10);
  lathe(g, [[0, 0], [0.032, 0], [0.036, 0.07], [0.033, 0.07], [0.03, 0.006], [0, 0.006]], m.porcelain, 0.0, 0.03, 0.16, 16);
  sph(g, 0.03, m.brass, 0.1, 0.4, -0.05, [1, 0.6, 1], 10);
  g.userData.noSolid = true;
  return g;
}
function kettle(p, m, x, y, z) {
  const g = grp(p, x, y, z);
  cyl(g, 0.08, 0.08, 0.02, m.darkPlastic, 0, 0, 0, 20);
  lathe(g, [[0, 0], [0.075, 0], [0.08, 0.1], [0.06, 0.2], [0, 0.21]], m.fam === 'nordic' ? m.blackMetal : m.steel, 0, 0.02, 0, 20);
  torus(g, 0.06, 0.01, m.darkPlastic, -0.08, 0.14, 0, [0, 0, HALF], Math.PI, 12);
  return g;
}

// Base-run plan between x0..x1 (tall column side `side`): [drawers][sink][dishwasher][drawers][hob][drawers][washer]
// (mirrored when the tall columns stand on the right). Returns null if even slimline appliances do not fit.
function packBase(x0, x1, side, washer, hobW) {
  const bl = x1 - x0;
  const tries = [[0.8, 0.6, hobW, washer], [0.8, 0.6, hobW, false], [0.6, 0.6, 0.6, false], [0.6, 0.45, 0.6, false]];
  for (let ti = 0; ti < tries.length; ti++) {
    const [sw, dw, hw, wm] = tries[ti], free = bl - sw - dw - hw - (wm ? 0.6 : 0);
    if (free < (ti === tries.length - 1 ? 0 : 0.4)) continue;
    let d1 = free * 0.3, d2 = free * 0.4, d3 = free * 0.3;
    if (d1 < 0.3) { d2 += d1; d1 = 0; }
    if (d3 < 0.3) { d2 += d3; d3 = 0; }
    const seq = [['D', d1], ['sink', sw], ['dw', dw], ['D', d2], ['hob', hw], ['D', d3]];
    if (wm) seq.push(['wm', 0.6]);
    if (side === 'right') seq.reverse();
    const mods = []; let cx = x0, hobX = 0, sinkX = 0;
    for (const [k, w] of seq) {
      if (w < 1e-3) continue;
      if (k === 'D') {
        if (w < 0.25) mods.push([cx, cx + w, 'filler']);
        else { const n = Math.ceil(w / 0.62 - 1e-6), mw = w / n; for (let i = 0; i < n; i++) mods.push([cx + i * mw, cx + (i + 1) * mw, 'drawers']); }
      } else { mods.push([cx, cx + w, k]); if (k === 'hob') hobX = cx + w / 2; if (k === 'sink') sinkX = cx + w / 2; }
      cx += w;
    }
    return { mods, hobX, hobW: hw, sinkX };
  }
  return null;
}
// Kitchen run along +x, back against z = -D/2 (the wall), fronts facing +z. opts:
//   len, tall: 'left'|'right'|'none', withOvenColumn, uppers: true, washer:false, hobAt (0..1), sinkAt (0..1), H (ceiling)
// Every front opens: drawers slide out 40 cm (cutlery trays, crockery, pots & pans), doors swing ~100°, oven and
// dishwasher flaps drop, fridge / freezer / microwave open; cupboards fill lazily with crockery / pantry goods.
function kitchenRun(m, len = 3, o = {}) {
  if (typeof len === 'object') { o = len; len = o.len || 3; }
  const g = new THREE.Group(), s = m.fam, D = 0.62, CH = o.ceiling || 2.7;
  const BH = 0.9, plinth = 0.1, T = 0.03;
  const front = m.lacquer, carcass = m.darkPlastic, inM = m.cabinetIn;
  const dsM = s === 'milano' ? m.darkPlastic : m.plastic;          // drawer sides (slim metal boxes)
  const cols = [];                                  // [x0, x1, kind]
  let x0 = -len / 2, x1 = len / 2;
  const tallSide = o.tall || 'left';
  const tallMods = [];
  if (tallSide !== 'none') { tallMods.push('fridge'); if (o.ovenColumn ?? len >= 3.4) tallMods.push('ovencol'); }
  for (const k of tallMods) {
    if (tallSide === 'left') { cols.push([x0, x0 + 0.6, k]); x0 += 0.6; } else { cols.push([x1 - 0.6, x1, k]); x1 -= 0.6; }
  }
  // base modules between x0..x1
  const bl = x1 - x0;
  const baseOven = !tallMods.includes('ovencol');
  let hobW = Math.min(0.8, bl > 2.2 ? 0.8 : 0.6);
  let hobX = x0 + bl * (o.hobAt ?? (tallSide === 'left' ? 0.72 : 0.3));
  let sinkX = x0 + bl * (o.sinkAt ?? (tallSide === 'left' ? 0.28 : 0.72));
  // packed plan: sink with the dishwasher beside it, the hob, drawer stacks in between and (if asked) the washer at
  // the far end; appliances shrink (slimline 45 cm dishwasher, 60 cm sink / hob) before a run loses its drawers
  // V3 (real interiors) — additive options: o.flip mirrors the base order of a run without tall columns (hob towards
  // −x); o.compact packs a run too short for the regular plan as [sink][hob][drawers] (or [hob][drawers] under 1.2 m);
  // o.plain makes a run of drawer units only (the second leg of an L-shaped kitchen: no sink, hob, dishwasher or hood);
  // o.noSink / o.noHob (with o.compact): one leg of an L-shaped kitchen that carries only the hob / only the sink
  const part = o.compact && (o.noSink || o.noHob);
  let packed = o.plain || part ? null : packBase(x0, x1, o.flip && tallSide === 'none' ? 'right' : tallSide, !!o.washer, hobW);
  if (!packed && o.compact && !o.plain && bl >= 0.6) {
    const seq = [];
    if (!o.noSink && (bl >= 1.2 || o.noHob)) seq.push(['sink', 0.6]);
    if (!o.noHob) seq.push(['hob', 0.6]);
    seq.push(['D', bl - 0.6 * seq.length]);
    if (o.flip ? tallSide !== 'right' : tallSide === 'right') seq.reverse();
    const mods0 = []; let cx = x0, hx = 0, sx = x0 - 9;
    for (const [k, w] of seq) { if (w < 0.02) continue; mods0.push([cx, cx + w, k === 'D' ? (w < 0.25 ? 'filler' : 'drawers') : k]); if (k === 'hob') hx = cx + w / 2; if (k === 'sink') sx = cx + w / 2; cx += w; }
    packed = o.noHob ? { mods: mods0, hobX: x0 - 0.05, hobW: 0, sinkX: sx } : { mods: mods0, hobX: hx, hobW: 0.6, sinkX: sx < x0 ? hx : sx };
  }
  if (packed) { hobW = packed.hobW; hobX = packed.hobX; sinkX = packed.sinkX; }
  // hollow carcass (back, bottom, top rail in interior veneer) + counter
  const zF = D / 2 - 0.02, zBk = -D / 2 + 0.016, dI = zF - zBk, zc = (zF + zBk) / 2, xc = (x0 + x1) / 2;
  box(g, bl, plinth, D - 0.06, carcass, xc, 0, -0.06);
  box(g, bl, BH - plinth - T, 0.016, inM, xc, plinth, -D / 2 + 0.008);
  box(g, bl, 0.018, dI, inM, xc, plinth, zc);
  // finished end panels (front material) where the run ends in the open, so the carcass never shows from the side
  if (tallSide !== 'left' || !tallMods.length) box(g, 0.02, BH - T, D, front, x0 + 0.01, 0, 0);
  if (tallSide !== 'right' || !tallMods.length) box(g, 0.02, BH - T, D, front, x1 - 0.01, 0, 0);
  // base fronts: split into modules of ~0.6, with appliances at hob/sink positions
  let mods = [];
  const hobL = hobX - hobW / 2, hobR = hobX + hobW / 2;
  if (packed) mods = packed.mods;
  else if (o.plain) { const n = Math.max(1, Math.round(bl / 0.6)); for (let i = 0; i < n; i++) mods.push([x0 + bl * i / n, x0 + bl * (i + 1) / n, 'drawers']); }
  else {
    // (legacy fallback for very short runs) fixed sink / hob positions, 60 cm modules in between
    let cx = x0;
    const pushUntil = (lim) => { while (lim - cx > 0.15) { const w = Math.min(0.6, lim - cx); mods.push([cx, cx + w, 'drawers']); cx += w; } cx = lim; };
    const sinkL = sinkX - 0.4, sinkR = sinkX + 0.4;
    const order = [[sinkL, sinkR, 'sink'], [hobL, hobR, 'hob']].sort((a, b) => a[0] - b[0]);
    for (const [a, b, k] of order) { if (a < cx) continue; pushUntil(a); mods.push([a, b, k]); cx = b; }
    pushUntil(x1);
    let dw = false, wm = !o.washer;
    for (const md of mods) if (md[2] === 'drawers' && md[1] - md[0] > 0.44) { if (!dw) { md[2] = 'dw'; dw = true; } else if (!wm && md[1] - md[0] > 0.55) { md[2] = 'wm'; wm = true; } }
  }
  // counter + top rail, both cut around the sink's basin (a real undermount bowl the tap runs into)
  const skm = mods.find(md => md[2] === 'sink'), cA = xc - bl / 2 - 0.002, cB = xc + bl / 2 + 0.002, cz0 = 0.01 - (D + 0.02) / 2, cz1 = 0.01 + (D + 0.02) / 2;
  const SBW = skm ? Math.min(0.56, skm[1] - skm[0] - 0.2) : 0, SBD = 0.36, SBH = 0.19, szc = 0.03, sxm = skm ? (skm[0] + skm[1]) / 2 : 0;
  if (skm) {
    const a = sxm - SBW / 2, b = sxm + SBW / 2, z0 = szc - SBD / 2, z1 = szc + SBD / 2, yT = BH - T;
    box(g, a - cA, T, D + 0.02, m.counter, (a + cA) / 2, yT, 0.01); box(g, cB - b, T, D + 0.02, m.counter, (b + cB) / 2, yT, 0.01);
    box(g, SBW, T, z0 - cz0, m.counter, sxm, yT, (z0 + cz0) / 2); box(g, SBW, T, cz1 - z1, m.counter, sxm, yT, (z1 + cz1) / 2);
    box(g, skm[0] - x0, 0.018, dI, inM, (skm[0] + x0) / 2, yT - 0.018, zc); box(g, x1 - skm[1], 0.018, dI, inM, (skm[1] + x1) / 2, yT - 0.018, zc);
    box(g, SBW + 0.02, 0.004, SBD + 0.02, m.steel, sxm, yT - SBH, szc);
    for (const sz of [-1, 1]) box(g, SBW + 0.02, SBH, 0.004, m.steel, sxm, yT - SBH, szc + sz * (SBD / 2 + 0.008));
    for (const sx of [-1, 1]) box(g, 0.004, SBH, SBD + 0.02, m.steel, sxm + sx * (SBW / 2 + 0.008), yT - SBH, szc);
    cyl(g, 0.026, 0.026, 0.004, m.chrome, sxm, yT - SBH + 0.004, szc, 16);
  } else { box(g, bl, 0.018, dI, inM, xc, BH - T - 0.018, zc); box(g, bl + 0.004, T, D + 0.02, m.counter, xc, BH - T, 0.01); }
  g.userData.hasWasher = mods.some(md => md[2] === 'wm');
  g.userData.hasDishwasher = mods.some(md => md[2] === 'dw');
  for (const [a] of mods) if (a > x0 + 0.05) box(g, 0.018, BH - plinth - T - 0.036, dI - 0.004, inM, a, plinth + 0.018, zc - 0.002);
  // --- openable fronts
  const drawer = (xm, y, w, hs, fill, seed = 1) => {
    const h = hs - 0.006, dr = drawerMv(g, xm, y, zF, h < 0.16 ? 0.34 : 0.4);
    box(dr, w - 0.006, h, 0.02, front, 0, 0, 0.01); shaker(dr, m, w - 0.006, h, 0, 0, 0.0205);
    handle(dr, m, 0, m.styleId === 'paris' ? h / 2 : hs - 0.05, 0.02, Math.min(0.3, w * 0.5));
    const bw = w - 0.06, bd = dI - 0.05, bh = Math.max(0.05, h - 0.06);
    box(dr, bw, 0.01, bd, inM, 0, 0.02, -bd / 2 - 0.006);
    for (const sx of [-1, 1]) box(dr, 0.012, bh, bd, dsM, sx * (bw / 2 - 0.006), 0.02, -bd / 2 - 0.006);
    box(dr, bw, bh, 0.012, dsM, 0, 0.02, -bd);
    if (fill && DFILL[fill]) DFILL[fill](grp(dr, 0, 0.03, -0.02), m, bw - 0.03, bd - 0.03, bh, seed);
    return dr;
  };
  const door = (xa, xb, y, h, side, comp, hy) => {
    const mv = hinged(g, xa + 0.003, xb - 0.003, y, zF, side, comp), w = xb - xa - 0.006;
    box(mv, w, h, 0.02, front, mv.userData.cx, 0, 0.01); shaker(mv, m, w, h, mv.userData.cx, 0, 0.0205);
    if (m.styleId === 'paris') handle(mv, m, mv.userData.cx - side * (w / 2 - 0.028), hy ?? h - 0.1, 0.02);
    else handle(mv, m, mv.userData.cx, hy ?? h - 0.05, 0.02, Math.min(0.3, w * 0.5));
    return mv;
  };
  let di = 0, dwN = 0;
  const fy = plinth + 0.003, fh = BH - plinth - T - 0.006, yIn = plinth + 0.018;
  for (const [a, b, k] of mods) {
    const w = b - a, xm = (a + b) / 2;
    if (k === 'hob') {
      if (baseOven) {
        const ov = oven(m); ov.position.set(xm, plinth + 0.12, D / 2 - 0.01); g.add(ov);
        drawer(xm, fy, w, 0.114, 'trays', 5);
        box(g, w - 0.006, BH - T - 0.817, 0.02, front, xm, 0.815, D / 2 - 0.01);
      } else { drawer(xm, fy, w, fh * 0.5, 'pans', 3); drawer(xm, fy + fh * 0.5, w, fh * 0.5, 'pots', 4); }
      const hb = hob(m, { w: Math.min(0.78, w - 0.04) }); hb.position.set(xm, BH, 0.0); g.add(hb);
      box(g, Math.min(0.74, w - 0.08), 0.05, 0.48, m.darkPlastic, xm, BH - T - 0.05, 0);          // hob housing under the counter
    } else if (k === 'sink') {
      rod(g, 0.02, 0.22, m.chrome, xm, BH - T - 0.31, 0.0); rod(g, 0.018, 0.3, m.chrome, xm, BH - T - 0.42, -0.15, [HALF, 0, 0]);
      const comp = compartment(g, (c) => underSink(c, m, w - 0.06, yIn, zBk, zF), xm, 0, 0);
      if (w > 0.65) { door(a, xm, fy, fh, -1, comp); door(xm, b, fy, fh, 1, comp); } else door(a, b, fy, fh, -1, comp);
      const sk = sink(m, { w, cut: true }); sk.position.set(xm, BH, 0); g.add(sk);
      const kdyn = playGroup(g, 'kitchen-dyn');
      const out = waterOutlet(kdyn, m, 'kitchen', 'tap', { x: xm, y: BH + 0.3, z: -0.07, drop: 0.3 + T + SBH - 0.006, r: 1.15, ring: 0.05 });
      out.proxy(0.22, 0.44, 0.34, xm, BH, -0.13);
      g.userData.sinkTap = kdyn.userData.sinkTap = out;
    } else if (k === 'dw') {
      // integrated dishwasher: the furniture door drops down (steel inner door), then both baskets glide out
      shell(g, m.steel, w - 0.04, fh - 0.03, dI - 0.03, xm, yIn, zF - 0.015 - (dI - 0.03) / 2, 0.008, { top: true });
      const gid = 'dw' + g.id + '-' + (dwN++);
      const comp = compartment(g, (c) => { fxFlat(c, m.glowFaint, 'grad', 0, 0.01, (zBk + zF) / 2, w - 0.08, dI - 0.06); box(c, w - 0.12, 0.006, 0.01, m.coldLed, 0, fh - 0.08, zBk + 0.06); }, xm, yIn + 0.01, 0);
      const fl = flap(g, xm, fy, zF, comp, 1.45); Object.assign(fl.userData.mover, { tag: 'dishwasher', group: gid, dOpen: 0, dClose: 520 });
      box(fl, w - 0.006, fh, 0.02, front, 0, 0, 0.01); shaker(fl, m, w - 0.006, fh, 0, 0, 0.0205); handle(fl, m, 0, fh - (m.styleId === 'paris' ? 0.028 : 0.05), 0.02, Math.min(0.3, w * 0.5));
      box(fl, w - 0.06, fh - 0.06, 0.012, m.steel, 0, 0.03, -0.006);
      cyl(fl, 0.025, 0.025, 0.012, m.darkPlastic, -w / 4, 0.25, -0.012, 14, [HALF, 0, 0]); box(fl, 0.09, 0.07, 0.012, m.darkPlastic, w / 8, 0.22, -0.018);   // detergent dispenser
      const dwm = dishwasher(m, { w }); dwm.position.set(0, fh - 0.74, 0.01); fl.add(dwm);
      dishRacks(g, m, xm, yIn + 0.01, w - 0.06, fh - 0.05, zBk + 0.02, zF - 0.02, gid);
    } else if (k === 'filler') {
      box(g, w - 0.006, fh, 0.02, front, xm, fy, zF + 0.01);
    } else if (k === 'wm') {
      // integrated washing machine behind a furniture door (status LED on the door; the machine's own porthole opens too)
      const wm = washer(m, { h: fh - 0.02, d: 0.55, integrated: true }); wm.position.set(xm, fy + 0.005, zF - 0.012 - 0.275); g.add(wm);
      const dm = door(a, b, fy, fh, -1, null);
      box(dm, 0.05, 0.006, 0.004, m.led, dm.userData.cx + (w - 0.006) / 2 - 0.07, fh - 0.02, 0.021);
    } else {
      // bottom → top: deep pan / pot / pantry drawers, then crockery, a shallow drawer on top (cutlery first, then spices)
      const hs = [fh * 0.4, fh * 0.35, fh * 0.25];
      const fills = [['pans', 'pantry', 'pots'][di % 3], di % 2 ? 'trays' : 'crockery', ['cutlery', 'spices', 'utensils', 'cutlery'][di % 4]];
      let yy = fy;
      for (let i = 0; i < 3; i++) { drawer(xm, yy, w, hs[i], fills[i], di * 3 + i); yy += hs[i]; }
      di++;
    }
  }
  // tall columns
  for (const [a, b, k] of cols) {
    const xm = (a + b) / 2, TH = Math.min(2.35, CH - 0.05);
    if (k === 'fridge') { const f = fridge(m, { h: TH }); f.position.set(xm, 0, 0); g.add(f); }
    else {
      shell(g, inM, 0.6, TH, D - 0.02, xm, 0, -0.01);
      drawer(xm, 0.003, 0.6, 0.36, 'pots', 7); drawer(xm, 0.363, 0.6, 0.36, 'trays', 9);
      for (const [y0, y1] of [[0.723, 0.76], [1.355, 1.39], [1.77, 1.8]]) box(g, 0.594, y1 - y0, 0.02, m.darkPlastic, xm, y0, zF - 0.012);
      box(g, 0.568, 0.016, dI, inM, xm, 0.723, zc); box(g, 0.568, 0.016, dI, inM, xm, 1.782, zc);
      const ov = oven(m); ov.position.set(xm, 0.76, D / 2 - 0.01); g.add(ov);
      const mw = microwave(m); mw.position.set(xm, 1.39, D / 2 - 0.01); g.add(mw);
      const top = TH - 1.8, mid = top > 0.46 ? 1.8 + top / 2 : null;
      if (mid) box(g, 0.568, 0.016, dI - 0.02, inM, xm, mid, zc - 0.01);
      const comp = compartment(g, (c) => {
        shelfFill(c, m, -0.27, 0.27, 0.016, zc, 'pantry', 17);
        if (mid) shelfFill(c, m, -0.27, 0.27, mid - 1.8 + 0.016, zc, 'glasses', 19);
        ledWash(c, m, 0, 0.56, 0.016, top - 0.016, zBk, zF);
      }, xm, 1.8, 0);
      door(xm - 0.3, xm + 0.3, 1.8, top, -1, comp, 0.06);
    }
  }
  // backsplash + uppers / shelves
  const paris = m.styleId === 'paris';
  const bsH = (s === 'milano' || paris) && !o.cut ? CH - BH : 0.62;
  const bsM = s === 'milano' ? m.marble : s === 'nordic' ? m.wallBath : m.wallBath;
  box(g, bl, bsH, 0.015, bsM, (x0 + x1) / 2, BH, -D / 2 + 0.0075);
  if (o.hood !== false && !o.cut && !o.plain && hobW > 0) { const hood0 = hood(m, { w: hobW, h: s === 'milano' ? CH - 1.62 - 0.12 : 0.9 }); hood0.position.set(hobX, 1.62, -D / 2 + 0.28); g.add(hood0); }
  if (o.uppers !== false) {
    const uy = 1.55, uh = s === 'milano' ? 0.7 : 0.72, ud = 0.36;
    const segs = [[x0, hobL - 0.05], [hobR + 0.05, x1]].filter(([a, b]) => b - a > 0.3);
    segs.forEach(([a, b], si) => {
      const w = b - a, xm = (a + b) / 2;
      // wall cabinets: all of them in milano; elsewhere the run next to the tall columns (the rest stays open shelving)
      const nearCols = tallSide === 'right' ? si === segs.length - 1 : si === 0;
      const closed = s === 'milano' || paris || (segs.length > 1 && nearCols && w >= 0.55);
      if (closed) {
        const zb = -D / 2, zf = -D / 2 + ud, uzc = (zb + 0.016 + zf) / 2, y0 = uy + 0.05;
        shell(g, inM, w, uh, ud, xm, y0, -D / 2 + ud / 2);
        box(g, w - 0.032, 0.016, ud - 0.03, inM, xm, y0 + uh / 2 - 0.008, uzc - 0.005);
        const pantry = nearCols && tallMods.length && !tallMods.includes('ovencol');
        const comp = compartment(g, (c) => {
          shelfFill(c, m, a + 0.02, b - 0.02, y0 + 0.016, uzc + 0.005, pantry ? 'pantry' : 'plates', ((a * 100) | 0) + 3);
          shelfFill(c, m, a + 0.02, b - 0.02, y0 + uh / 2 + 0.008, uzc + 0.005, 'glasses', ((a * 100) | 0) + 5);
          ledWash(c, m, xm, w - 0.03, y0 + 0.016, y0 + uh - 0.016, zb + 0.016, zf);
        });
        const n = Math.max(1, Math.round(w / 0.6)), dw = w / n;
        for (let i = 0; i < n; i++) {
          const side = n === 1 ? (hobX > xm ? -1 : 1) : i % 2 === 0 && i !== n - 1 ? -1 : 1;
          const mv = hinged(g, a + i * dw + 0.003, a + (i + 1) * dw - 0.003, uy + 0.053, zf, side, comp), ww = dw - 0.006;
          box(mv, ww, uh - 0.006, 0.02, s === 'milano' ? (i % 2 ? m.woodDark : m.lacquer) : front, mv.userData.cx, 0, 0.01);
          shaker(mv, m, ww, uh - 0.006, mv.userData.cx, 0, 0.0205);
          if (s !== 'milano') handle(mv, m, mv.userData.cx - side * (ww / 2 - (paris ? 0.028 : 0.04)), paris ? 0.1 : 0.13, 0.02, 0.16, true);
        }
        box(g, w, 0.008, 0.02, m.led, xm, uy + 0.045, -D / 2 + ud - 0.05);
        fxQuad(g, m.glow, 'grad', [xm, uy - 0.28, -D / 2 + 0.018], [w, 0, 0], [0, 0.66, 0]);
        fxFlat(g, m.glowFaint, 'grad', xm, BH + 0.002, -D / 2 + 0.28, w, 0.56);
        box(g, w, 0.012, ud + 0.02, s === 'milano' || paris ? m.brass : s === 'nordic' ? m.woodLight : m.woodDark, xm, uy + 0.04, -D / 2 + ud / 2 + 0.01);
        if (paris) box(g, w + 0.02, 0.04, ud + 0.03, front, xm, uy + 0.05 + uh, -D / 2 + ud / 2 + 0.005);     // cornice cap
      } else {
        // open shelves with crockery
        for (const [yy, i] of [[uy + 0.05, 0], [uy + 0.45, 1]]) {
          box(g, w, 0.035, 0.26, s === 'nordic' ? m.woodLight : m.woodDark, xm, yy, -D / 2 + 0.13);
          if (i === 0) {
            box(g, w - 0.04, 0.006, 0.02, m.led, xm, yy - 0.006, -D / 2 + 0.2);
            fxQuad(g, m.glow, 'grad', [xm, yy - 0.34, -D / 2 + 0.018], [w - 0.04, 0, 0], [0, 0.66, 0]);
            fxFlat(g, m.glowFaint, 'grad', xm, BH + 0.002, -D / 2 + 0.28, w, 0.56);
          }
          const r = rngF((a * 100) | 0 + i);
          let x = a + 0.1;
          while (x < b - 0.12) {
            const k = (r() * 4) | 0;
            if (k === 0) { for (let j = 0; j < 5; j++) plate(g, m, x + 0.06, yy + 0.035 + j * 0.014, -D / 2 + 0.13, 0.11, j % 2 && s === 'riviera' ? m.ceramic2 : m.ceramic); x += 0.26; }
            else if (k === 1) { for (let j = 0; j < 3; j++) glass(g, m, x + j * 0.08, yy + 0.035, -D / 2 + 0.13, 'tumbler'); x += 0.26; }
            else if (k === 2) { lathe(g, [[0, 0], [0.06, 0], [0.065, 0.16], [0, 0.16]], j2(m, r), x + 0.07, yy + 0.035, -D / 2 + 0.13, 16); x += 0.18; }
            else { bowl(g, m, x + 0.1, yy + 0.035, -D / 2 + 0.13, 0.1, m.ceramic2, false); x += 0.24; }
          }
        }
      }
    });
    // top filler above the tall columns
    for (const [a, b] of cols) box(g, b - a, CH - 2.35 - 0.02, D - 0.02, front, (a + b) / 2, 2.35, -0.01);
  }
  // countertop styling
  const cm = coffeeMachine(m); cm.position.set(x0 + 0.25 < hobL - 0.2 ? x0 + 0.22 : x1 - 0.22, BH, -0.1); g.add(cm);
  if (o.compact && (bl < 1.9 || part) || o.plain && bl < 1.2) { g.userData.solidBox = { w: len, d: D, h: BH }; return g; }   // (V3: a short run has no room for the styling set)
  kettle(g, m, sinkX + (hobX > sinkX ? 0.55 : -0.55), BH, -0.12);
  const bx = (sinkX + hobX) / 2;
  box(g, 0.4, 0.025, 0.28, s === 'milano' ? m.woodDark : m.woodLight, bx, BH, 0.02, [0, 0.12, 0]);
  bread(g, m, bx + 0.05, BH + 0.025, 0.02);
  for (let i = 0; i < 2; i++) lathe(g, [[0, 0], [0.03, 0], [0.03, 0.2], [0.012, 0.24], [0.01, 0.28], [0, 0.28]], i ? m.oil : m.bottle, hobX + hobW / 2 + 0.12 + i * 0.07, BH, -0.2, 12);
  lathe(g, [[0, 0], [0.05, 0], [0.055, 0.15], [0, 0.15]], m.ceramic, hobX - hobW / 2 - 0.12, BH, -0.2, 16);
  for (let i = 0; i < 4; i++) rod(g, 0.006, 0.28, i % 2 ? m.woodLight : m.steel, hobX - hobW / 2 - 0.12 + (i - 1.5) * 0.012, BH + 0.2, -0.2, [0.1 * (i - 1.5), 0, 0.08 * (i - 1.5)], 6);
  plantSmall(g, m, sinkX - 0.35 * Math.sign(hobX - sinkX || 1), BH, -0.2, 0.22, 1.2);
  g.userData.solidBox = { w: len, d: D, h: BH };
  return g;
}
function j2(m, r) { return r() < 0.5 ? m.ceramic : m.ceramic2; }
function bread(p, m, x, y, z) { sph(p, 0.07, m.bread, x, y + 0.03, z, [1.6, 0.6, 0.9], 12); }

// Kitchen island: stone worktop with waterfall ends and a real undermount prep sink (the worktop is cut around the
// basin) under a high-arc tap on the working side (−z); drawer stacks and the sink cupboard open towards −z (same
// movers / contents as kitchenRun); bar stools stand under the overhang on the living side (+z).
// Everything that plays lives in ONE unbaked group (userData.keep): the tap's water, the chef's knife and a single
// instanced mesh for the vegetables and their slices. Invisible proxies carry userData.playPart ('tap' | 'chop' |
// 'salad') + userData.toggle — apartment.js turns playPart into the walkthrough's tap action.
let WATER = null;
function islandKnifeGeo() {
  return cg('islKnife', () => {
    const sh = new THREE.Shape();           // blade profile in (length, height): heel at 0, tip at 0.2, edge down
    sh.moveTo(0, 0.024); sh.lineTo(0.13, 0.022); sh.quadraticCurveTo(0.185, 0.016, 0.205, -0.02); sh.quadraticCurveTo(0.12, -0.026, 0, -0.024); sh.lineTo(0, 0.024);
    const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.002, bevelEnabled: false, curveSegments: 6 });
    blade.translate(0, 0, -0.001); blade.rotateY(-HALF);                    // length → +z, thin in x
    const parts = [[blade, '#d9dcde'], [new THREE.BoxGeometry(0.02, 0.03, 0.115).translate(0, 0.004, -0.0625).toNonIndexed(), '#1b1816'],
      [new THREE.BoxGeometry(0.014, 0.04, 0.012).translate(0, 0, -0.004).toNonIndexed(), '#b9bbbd']];
    for (const [geo, hex] of parts) { const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); geo.deleteAttribute('uv'); }
    const out = mergeGeometries(parts.map(q => q[0])); parts.forEach(q => q[0].dispose()); return out;
  });
}
// vegetables: [kind, whole scale, whole colour, slices, slice scale, slice colour]
const VEG = [
  ['tomato', [0.034, 0.03, 0.034], '#c8321f', 7, [0.031, 0.0045, 0.031], '#dc4a30'],
  ['cucumber', [0.085, 0.019, 0.019], '#3c7a31', 10, [0.019, 0.0035, 0.019], '#b9dc8e'],
  ['pepper', [0.036, 0.043, 0.036], '#e6b422', 8, [0.034, 0.0045, 0.009], '#f0c53a'],
  ['lettuce', [0.068, 0.052, 0.068], '#8fc45a', 9, [0.05, 0.004, 0.038], '#b4de78'],
  ['tomato', [0.032, 0.029, 0.032], '#c23a22', 7, [0.03, 0.0045, 0.03], '#dc4a30'],
];
function island(m, o = {}) {
  const L = o.len || 2.0, D = o.depth || 0.86, g = new THREE.Group(), H = 0.9, T = 0.03, plinth = 0.1, KD = 0.62;
  const front = m.lacquer, carcass = m.darkPlastic, inM = m.cabinetIn, dsM = m.fam === 'milano' ? m.darkPlastic : m.plastic, top = m.counter;
  const bl = L - 0.06, zOff = -(D / 2 - KD / 2);
  // ---- working side: a 62 cm base unit facing −z (built front = +z in a group turned by π)
  const wk = grp(g, 0, 0, zOff, Math.PI);
  const zF = KD / 2 - 0.02, zBk = -KD / 2 + 0.016, dI = zF - zBk, zc = (zF + zBk) / 2;
  box(wk, bl, plinth, KD - 0.06, carcass, 0, 0, -0.03);
  box(wk, bl, H - plinth - T, 0.016, inM, 0, plinth, -KD / 2 + 0.008);
  const n = Math.max(2, Math.round(bl / 0.62)), mw = bl / n;
  box(wk, bl, 0.018, dI, inM, 0, plinth, zc); box(wk, bl - mw, 0.018, dI, inM, mw / 2, H - T - 0.018, zc);   // top rail: not over the basin
  const fy = plinth + 0.003, fh = H - plinth - T - 0.006, yIn = plinth + 0.018;
  for (let i = 1; i < n; i++) box(wk, 0.018, H - plinth - T - 0.036, dI - 0.004, inM, -bl / 2 + i * mw, plinth + 0.018, zc - 0.002);
  const drawer = (xm, y, w, hs, fill, seed = 1) => {
    const h = hs - 0.006, dr = drawerMv(wk, xm, y, zF, h < 0.16 ? 0.34 : 0.4);
    box(dr, w - 0.006, h, 0.02, front, 0, 0, 0.01); shaker(dr, m, w - 0.006, h, 0, 0, 0.0205);
    handle(dr, m, 0, m.styleId === 'paris' ? h / 2 : hs - 0.05, 0.02, Math.min(0.3, w * 0.5));
    const bw = w - 0.06, bd = dI - 0.05, bh = Math.max(0.05, h - 0.06);
    box(dr, bw, 0.01, bd, inM, 0, 0.02, -bd / 2 - 0.006);
    for (const sx of [-1, 1]) box(dr, 0.012, bh, bd, dsM, sx * (bw / 2 - 0.006), 0.02, -bd / 2 - 0.006);
    box(dr, bw, bh, 0.012, dsM, 0, 0.02, -bd);
    if (fill && DFILL[fill]) DFILL[fill](grp(dr, 0, 0.03, -0.02), m, bw - 0.03, bd - 0.03, bh, seed);
  };
  const FILLS = [['pots', 'crockery', 'utensils'], ['pantry', 'trays', 'cutlery'], ['pans', 'crockery', 'spices']];
  const xs = -bl / 2 + mw / 2, zs = 0.03;                    // sink module (wk frame) and basin centre
  const BW = Math.min(0.5, mw - 0.14), BD2 = 0.36, BH = 0.19; // basin opening
  for (let i = 0; i < n; i++) {
    const a = -bl / 2 + i * mw, xm = a + mw / 2;
    if (i === 0) {
      rod(wk, 0.02, 0.2, m.chrome, xm, H - T - BH - 0.1, zs); rod(wk, 0.018, 0.3, m.chrome, xm, H - T - BH - 0.2, zs - 0.15, [HALF, 0, 0]);
      const comp = compartment(wk, (c) => underSink(c, m, mw - 0.06, yIn, zBk, zF), xm, 0, 0);
      for (const [x0, x1, side] of mw > 0.65 ? [[a, xm, -1], [xm, a + mw, 1]] : [[a, a + mw, -1]]) {
        const mv = hinged(wk, x0 + 0.003, x1 - 0.003, fy, zF, side, comp), w = x1 - x0 - 0.006;
        box(mv, w, fh, 0.02, front, mv.userData.cx, 0, 0.01); shaker(mv, m, w, fh, mv.userData.cx, 0, 0.0205);
        if (m.styleId === 'paris') handle(mv, m, mv.userData.cx - side * (w / 2 - 0.028), fh - 0.1, 0.02); else handle(mv, m, mv.userData.cx, fh - 0.05, 0.02, Math.min(0.3, w * 0.5));
      }
    } else {
      const hs = [fh * 0.4, fh * 0.35, fh * 0.25], fl = FILLS[(i - 1) % FILLS.length];
      let yy = fy; for (let k = 0; k < 3; k++) { drawer(xm, yy, mw, hs[k], fl[k], 31 + i * 3 + k); yy += hs[k]; }
    }
  }
  // ---- living side: finished back panel under the overhang, stone waterfall ends, worktop cut around the basin
  const zB = zOff + KD / 2;                                   // carcass back (island frame)
  box(g, bl, H - T - 0.06, 0.02, m.fam === 'nordic' ? m.woodLight : m.fam === 'milano' ? m.woodDark : front, 0, 0.06, zB + 0.01);
  box(g, bl, 0.06, 0.02, carcass, 0, 0, zB - 0.01);
  if (m.fam !== 'nordic') box(g, bl, 0.012, 0.004, m.metal, 0, 0.06, zB + 0.021);
  for (const sx of [-1, 1]) box(g, 0.03, H - T, D, top, sx * (L / 2 - 0.015), 0, 0);
  const sxI = -xs, szI = zOff - zs;                           // basin centre in the island frame
  const x0 = sxI - BW / 2, x1 = sxI + BW / 2, z0 = szI - BD2 / 2, z1 = szI + BD2 / 2, yT = H - T;
  box(g, x0 + L / 2, T, D, top, (x0 - L / 2) / 2, yT, 0); box(g, L / 2 - x1, T, D, top, (x1 + L / 2) / 2, yT, 0);
  box(g, BW, T, z0 + D / 2, top, sxI, yT, (z0 - D / 2) / 2); box(g, BW, T, D / 2 - z1, top, sxI, yT, (z1 + D / 2) / 2);
  box(g, BW + 0.02, 0.004, BD2 + 0.02, m.steel, sxI, yT - BH, szI);
  for (const sz of [-1, 1]) box(g, BW + 0.02, BH, 0.004, m.steel, sxI, yT - BH, szI + sz * (BD2 / 2 + 0.008));
  for (const sx of [-1, 1]) box(g, 0.004, BH, BD2 + 0.02, m.steel, sxI + sx * (BW / 2 + 0.008), yT - BH, szI);
  cyl(g, 0.026, 0.026, 0.004, m.chrome, sxI, yT - BH + 0.004, szI, 16);                        // waste
  // high-arc tap on the living side of the basin, spout towards the cook; soap dispenser beside it
  const tz = z1 + 0.07, th = 0.36;
  const tp = tap(g, m, sxI, H, tz, th); tp.rotation.y = Math.PI;
  cyl(g, 0.017, 0.015, 0.05, m.tap, sxI, H + th - 0.085, tz - 0.16, 14);                          // spray head
  cyl(g, 0.02, 0.022, 0.012, m.tap, sxI + 0.16, H, tz, 14); rod(g, 0.009, 0.1, m.tap, sxI + 0.16, H + 0.06, tz); rod(g, 0.006, 0.07, m.tap, sxI + 0.16, H + 0.105, tz - 0.03, [HALF, 0, 0], 8);
  // ---- prep set: board (cook's side), the vegetables in a row behind it, the salad bowl towards the bar
  const bX = Math.max(-L / 2 + 0.36, Math.min(sxI - 0.72, L / 2 - 0.36)), bZ = -D / 2 + 0.25, vZ = bZ + 0.25, wZ = Math.min(D / 2 - 0.16, vZ + 0.2), bowlR = 0.13;
  rbox(g, 0.44, 0.022, 0.3, 0.008, m.fam === 'milano' ? m.woodDark : m.woodLight, bX, H, bZ);
  bowl(g, m, bX, H, wZ, bowlR, m.ceramic, false);
  if (L >= 1.75) vase(g, m, -L / 2 + 0.2, H, D / 2 - 0.22, 0.26, m.fam === 'milano' ? m.ceramic2 : m.pot2, true);
  // ---- bar stools
  const st = o.stools === false ? 0 : (o.stools ?? Math.max(1, Math.floor((L - 0.2) / 0.62)));
  for (let i = 0; i < st; i++) { const sg2 = stool(m); sg2.position.set(-L / 2 + L / st * (i + 0.5), 0, D / 2 + 0.17); sg2.rotation.y = Math.PI; g.add(sg2); }
  g.userData.solidBox = st ? { w: L, d: D + 0.28, h: H, z: 0.14 } : { w: L, d: D, h: H };
  g.userData.ao = { w: L, d: D };

  // ================= interactive (unbaked) parts
  const dyn = grp(g, 0, 0, 0); dyn.userData.keep = true; dyn.name = 'island-dyn';
  const alive = () => !!dyn.parent;
  const tween = (ms, fn) => new Promise(res => {
    const t0 = performance.now();
    const step = () => { if (!alive()) return res(false); const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(step); else res(true); };
    step();
  });
  const proxy = (part, w, h, d, x, y, z, toggle) => {
    const px = new THREE.Mesh(UB(), m.collider); px.scale.set(w, h, d); px.position.set(x, y + h / 2, z); px.name = 'island-' + part;
    px.userData.playPart = part; px.userData.piece = 'island'; px.userData.open = false; px.userData.toggle = toggle; dyn.add(px); return px;
  };
  // -- water: a thin stream from the spray head into the basin + a rippling splash
  if (!WATER) { WATER = new THREE.MeshPhysicalMaterial({ color: '#dcecf6', roughness: 0.04, transparent: true, opacity: 0.6, envMapIntensity: 1.3, depthWrite: false }); WATER.name = 'water'; }
  const wTop = H + th - 0.088, wBot = yT - BH + 0.006, wLen = wTop - wBot;
  const water = grp(dyn, sxI, 0, tz - 0.16); water.visible = false; water.name = 'tap-water';
  const stream = new THREE.Mesh(cg('islStream', () => new THREE.CylinderGeometry(0.0055, 0.0075, 1, 8, 1, true).translate(0, -0.5, 0)), WATER);
  stream.position.y = wTop; stream.scale.y = 0.001; stream.raycast = () => {}; stream.renderOrder = 2; water.add(stream);
  const splash = new THREE.Mesh(cg('islSplash', () => new THREE.RingGeometry(0.004, 0.034, 18).rotateX(-HALF)), WATER);
  splash.position.y = wBot; splash.visible = false; splash.raycast = () => {}; splash.renderOrder = 2; water.add(splash);
  stream.onBeforeRender = () => { const t = performance.now() * 0.03; stream.scale.x = stream.scale.z = 1 + 0.14 * Math.sin(t * 1.7); const k = 1 + 0.3 * Math.sin(t); splash.scale.set(k, 1, k); };
  let running = false, wTok = 0;
  const tapPx = proxy('tap', 0.26, th + 0.06, 0.3, sxI + 0.05, H, tz - 0.07, (on) => {
    const want = on === undefined ? !running : !!on; if (want === running) return Promise.resolve();
    running = want; tapPx.userData.open = tapPx.userData._open = want; const tok = ++wTok;
    if (want) { water.visible = true; splash.visible = false; stream.position.y = wTop; return tween(190, k => { if (tok !== wTok) return; stream.scale.y = Math.max(0.001, wLen * k); if (k === 1) splash.visible = true; }); }
    splash.visible = false;                                   // closing: the tail of the stream falls away
    return tween(160, k => { if (tok !== wTok) return; stream.position.y = wTop - wLen * k; stream.scale.y = Math.max(0.001, wLen * (1 - k)); if (k === 1) water.visible = false; });
  });
  // -- vegetables + slices: one instanced mesh (unit sphere, per-instance scale / colour)
  const nS = VEG.reduce((a, v) => a + v[3], 0), nI = VEG.length + nS;
  const food = new THREE.InstancedMesh(cg('islFood', () => { const sg3 = new THREE.SphereGeometry(1, 14, 9); sg3.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sg3.attributes.position.count * 3).fill(1), 3)); return sg3; }), m.food, nI);
  food.name = 'island-food'; food.frustumCulled = false; food.raycast = () => {}; dyn.add(food);
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P3 = new THREE.Vector3(), S3 = new THREE.Vector3(), E = new THREE.Euler(), col = new THREE.Color();
  const setI = (i, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { M4.compose(P3.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz)); food.setMatrixAt(i, M4); food.instanceMatrix.needsUpdate = true; };
  const rnd = rngM(71 + Math.round(L * 10));
  const restX = (k) => bX - 0.3 + [0.0, 0.16, 0.34, 0.5, 0.07][k], restZ = (k) => vZ + [0.0, 0.01, 0, 0.02, -0.075][k];
  const slices = [];                                          // per vegetable: [{i, ry, bx, bz, bh}]
  { let si = VEG.length;
    VEG.forEach((v, k) => { food.setColorAt(k, col.set(v[2])); const arr = []; for (let j = 0; j < v[3]; j++, si++) { food.setColorAt(si, col.set(v[5]).offsetHSL(0, 0, (rnd() - 0.5) * 0.06)); const a = rnd() * 6.283; arr.push({ i: si, ry: rnd() * 3, a, rr: Math.sqrt(rnd()), tilt: (rnd() - 0.5) * 0.7 }); } slices.push(arr); });
    food.instanceColor.needsUpdate = true; }
  const whole = (k, kx = 1, x = restX(k), y = H, z = restZ(k)) => { const s = VEG[k][1]; setI(k, x, y + s[1] * 0.96, z, Math.max(1e-5, s[0] * kx), kx ? s[1] : 1e-5, kx ? s[2] : 1e-5); };
  const hideAll = () => { for (const arr of slices) for (const q of arr) setI(q.i, bX, H - 0.2, bZ, 1e-5, 1e-5, 1e-5); };
  hideAll(); VEG.forEach((v, k) => whole(k));
  // -- chef's knife (rests on the board, edge down)
  const knife = new THREE.Mesh(islandKnifeGeo(), m.goods); knife.name = 'island-knife'; knife.raycast = () => {}; dyn.add(knife);
  const kRest = [bX + 0.15, H + 0.022 + 0.0105, bZ - 0.03];     // lying flat on the board
  const kPose = (x, y, z, pitch = 0, yaw = 0, roll = 0) => { knife.position.set(x, y, z); knife.rotation.set(pitch, yaw, roll, 'YXZ'); };
  kPose(...kRest, 0, 0.12, HALF);
  const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  let next = 0, busy = false, queued = 0, piled = 0, resetT = 0;
  const yB = H + 0.022;                                       // board top
  const chopOne = async (k) => {
    const v = VEG[k], sw = v[1], arr = slices[k], x0 = restX(k), z0 = restZ(k), cx = bX - 0.02, len = sw[0] * 2;
    // the vegetable hops onto the board, the knife comes over it
    await tween(300, t => { const e = ease(t); whole(k, 1, x0 + (cx - x0) * e, H + (yB - H) * e + Math.sin(t * Math.PI) * 0.07, z0 + (bZ - z0) * e); });
    const kz = bZ - 0.09, kLo = yB + 0.03, kHi = sw[1] * 2 + 0.07;
    const from = knife.position.clone(), fy0 = knife.rotation.y;
    await tween(260, t => { const e = ease(t); kPose(from.x + (cx + len / 2 - from.x) * e, from.y + (kLo + kHi - from.y) * e + Math.sin(t * Math.PI) * 0.05, from.z + (kz - from.z) * e, 0.3 * e, fy0 * (1 - e), HALF * (1 - e)); });
    for (let j = 0; j < arr.length; j++) {
      const q = arr[j], f1 = (j + 1) / arr.length, xc = cx + len / 2 - len * f1;      // cut line moves from +x to −x
      const ok = await tween(125, t => {
        const down = t < 0.55 ? ease(t / 0.55) : 1 - ease((t - 0.55) / 0.45);
        kPose(xc + 0.004, kLo + kHi * (1 - down), kz, 0.3 * (1 - down), 0);
        if (t >= 0.55 && !q.cut) {
          q.cut = true;
          whole(k, 1 - f1, cx - len * f1 / 2, yB, bZ);
          const ss = v[4]; q.px = cx + len / 2 + 0.02 + (arr.length - j) * 0.012; q.pz = bZ + (q.rr - 0.5) * 0.03; q.py = yB + Math.max(ss[0], ss[2]) * 0.62;
          setI(q.i, q.px, q.py, q.pz, ss[0], ss[1], ss[2], 0, q.ry * 0.15, 1.0);
        }
      });
      if (!ok) return false;
    }
    whole(k, 0);
    // knife back to its rest, slices sail into the bowl
    const kf = knife.position.clone(), kp = knife.rotation.x;
    tween(320, t => { const e = ease(t); kPose(kf.x + (kRest[0] - kf.x) * e, kf.y + (kRest[1] - kf.y) * e + Math.sin(t * Math.PI) * 0.04, kf.z + (kRest[2] - kf.z) * e, kp * (1 - e), 0.12 * e, HALF * e); });
    await Promise.all(arr.map((q, j) => new Promise(res => setTimeout(res, j * 55)).then(() => {
      // landing spot: the pile rises with every slice and stays inside the bowl's inner wall at that height
      const ss = v[4], h = H + 0.03 + piled * 0.0013, rm = Math.max(0, Math.min(0.085, (h - H - 0.0104) / 0.0366 * 0.103 - 0.024)) * q.rr; piled++;
      const tx = bX + Math.cos(q.a) * rm, tz2 = wZ + Math.sin(q.a) * rm;
      return tween(380, t => { const e = ease(t); setI(q.i, q.px + (tx - q.px) * e, q.py + (h - q.py) * e + Math.sin(t * Math.PI) * 0.12, q.pz + (tz2 - q.pz) * e, ss[0], ss[1], ss[2], q.tilt * e, q.ry + t * 4, 1.0 * (1 - e) + q.tilt * 0.6 * e); });
    })));
    return alive();
  };
  const reset = async () => {
    clearTimeout(resetT); if (busy || (!next && !piled)) return; busy = true;
    const mats = []; for (const arr of slices) for (const q of arr) { q.cut = false; food.getMatrixAt(q.i, M4); mats.push([q.i, M4.clone()]); }
    await tween(260, t => { for (const [i, mm] of mats) { mm.decompose(P3, Q, S3); S3.multiplyScalar(Math.max(1e-4, 1 - t)); M4.compose(P3, Q, S3); food.setMatrixAt(i, M4); } food.instanceMatrix.needsUpdate = true; });
    hideAll(); next = 0; piled = 0; queued = 0;
    await tween(320, t => { const e = ease(t) * (1 + 0.25 * Math.sin(t * Math.PI)); VEG.forEach((v, k) => whole(k, Math.max(0.02, e))); });
    VEG.forEach((v, k) => whole(k)); busy = false; chopPx.userData.open = bowlPx.userData.open = false;
  };
  const pump = async () => {
    if (busy) return; busy = true; clearTimeout(resetT);
    while (queued > 0 && next < VEG.length && alive()) { queued--; if (!(await chopOne(next))) break; next++; chopPx.userData.open = bowlPx.userData.open = true; }
    queued = 0; busy = false;
    if (next >= VEG.length && alive()) resetT = setTimeout(reset, 45000);       // a full bowl clears itself after a while
  };
  const chopPx = proxy('chop', 0.74, 0.14, 0.46, bX + 0.04, H, (bZ + vZ) / 2 - 0.02, () => {
    if (next >= VEG.length && !busy) return reset();
    queued = Math.min(VEG.length - next, queued + 1); return pump();
  });
  const bowlPx = proxy('salad', 0.3, 0.16, 0.24, bX, H, wZ + 0.02, () => (next || piled) ? reset() : (queued = 1, pump()));
  g.userData.island = dyn.userData.island = { len: L, depth: D, stools: st, get chopped() { return next; }, get running() { return running; }, get busy() { return busy; }, parts: { tap: tapPx, chop: chopPx, salad: bowlPx }, food, knife, water };
  return g;
}

// ================================================================== WATER PLAY (taps, showers, toilets, shampoo)
// Every fixture owns ONE unbaked group (userData.keep) with its invisible tap proxies — userData.playPart +
// userData.toggle, which apartment.js turns into the walkthrough's tap action, exactly like the island — and, only
// while it runs, effect meshes borrowed from a module-wide pool (fxTake / fxGive). Effects advance from their own
// onBeforeRender (shader time or a few matrices), so an idle or unseen fixture costs nothing; running water turns
// itself off after WATER_AUTO_MS.
const WATER_AUTO_MS = 60000;
const NORAY = () => {};
const FXP = new Map();
const fxTake = (kind, make) => { const l = FXP.get(kind); return (l && l.pop()) || make(); };
const fxGive = (kind, o) => { if (o.parent) o.parent.remove(o); let l = FXP.get(kind); if (!l) FXP.set(kind, l = []); l.push(o); };
const sec = () => performance.now() / 1000;
const sat = (x) => Math.max(0, Math.min(1, x));
const easeIO = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const tweenMs = (ms, fn) => new Promise(res => { const t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(step); else res(true); }; step(); });
let STREAM = null, BOWLWATER = null;
// a touch bluer and denser than the island's: most basins and tubs are white
function streamMat() {
  if (!STREAM) { STREAM = new THREE.MeshPhysicalMaterial({ color: '#a8d4ee', roughness: 0.04, transparent: true, opacity: 0.72, envMapIntensity: 1.3, depthWrite: false }); STREAM.name = 'stream'; }
  return STREAM;
}
function bowlWaterMat() {
  if (!BOWLWATER) { BOWLWATER = new THREE.MeshPhysicalMaterial({ color: '#4aa3cc', roughness: 0.03, transparent: true, opacity: 0.8, envMapIntensity: 1.1, depthWrite: false }); BOWLWATER.name = 'bowlWater'; }
  return BOWLWATER;
}
function playGroup(g, name) { const dyn = grp(g, 0, 0, 0); dyn.userData.keep = true; dyn.name = name; return dyn; }
function playProxy(dyn, m, piece, part, w, h, d, x, y, z, toggle) {
  const px = new THREE.Mesh(UB(), m.collider); px.scale.set(w, h, d); px.position.set(x, y + h / 2, z); px.name = piece + '-' + part;
  px.userData.playPart = part; px.userData.piece = piece; px.userData.open = false; px.userData.toggle = toggle; dyn.add(px); return px;
}
// --- effect shaders: time (uT) and a per-mesh strength / window (uK, uA, uB) are set from each mesh's onBeforeRender
const FXM = {};
const FX_VS = 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }';
function fxMat(key, vs, fs, side = THREE.DoubleSide) {
  if (!FXM[key]) {
    FXM[key] = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uK: { value: 1 }, uA: { value: 0 }, uB: { value: 1 } }, vertexShader: vs,
      fragmentShader: 'uniform float uT, uK, uA, uB; varying vec2 vUv; varying vec3 vP;\n' + fs, transparent: true, depthWrite: false, side });
    FXM[key].name = 'fx-' + key;
  }
  return FXM[key];
}
function fxMesh(geo, mat, k = () => 1) {
  const o = new THREE.Mesh(geo, mat); o.raycast = NORAY; o.renderOrder = 2;
  o.onBeforeRender = () => { const u = mat.uniforms, f = o.userData.fx; u.uT.value = sec() % 4096; u.uK.value = k(); u.uA.value = f ? f.a : 0; u.uB.value = f ? f.b : 1; mat.uniformsNeedUpdate = true; };
  return o;
}
const END_FS = '\n#include <colorspace_fragment>\n}';
// expanding rings where a stream meets water (uA = ring frequency)
const rippleMat = () => fxMat('ripple', FX_VS, `void main(){ float r = length(vUv - 0.5) * 2.; if (r > 1.) discard;
  float ring = smoothstep(0.3, 1., sin(r * uA - uT * 12.));
  gl_FragColor = vec4(mix(vec3(0.5, 0.76, 0.93), vec3(0.94, 0.98, 1.), ring), (0.3 + 0.55 * ring) * (1. - r) * (1. - r * 0.3) * uK);` + END_FS);
// rain hitting the shower floor: one little ring per cell, each on its own clock
const splashMat = () => fxMat('splash', FX_VS, `void main(){ float r = length(vUv - 0.5) * 2.; if (r > 1.) discard;
  vec2 p = vUv * uA, c = floor(p), f = fract(p) - 0.5; float h = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
  float t = fract(uT * (1.3 + h) + h * 7.), d = length(f) * 2.;
  float ring = smoothstep(0.16, 0., abs(d - t * 0.85)) * (1. - t);
  gl_FragColor = vec4(vec3(0.95, 0.98, 1.), (ring * 0.6 + 0.07) * (1. - smoothstep(0.55, 1., r)) * uK);` + END_FS);
// flush: three foam arms spiralling down the bowl
const swirlMat = () => fxMat('swirl', FX_VS, `void main(){ float a = atan(vP.z, vP.x), s = length(vP.xz);
  float foam = smoothstep(0.1, 0.95, sin(a * 3. + s * 60. + uT * 10.) * 0.5 + 0.5);
  gl_FragColor = vec4(mix(vec3(0.16, 0.5, 0.74), vec3(0.86, 0.95, 1.), foam), uK * (0.55 + 0.4 * foam));` + END_FS);
// shower rain: streaks falling in a widening cone (unit cone: radius 1 at the floor, height 1, apex side at y = 0);
// only streaks between uA and uB of the fall are drawn (the water front on start, the tail on stop)
const rainMat = () => fxMat('rain', `attribute vec4 aS; attribute vec2 aE; uniform float uT, uK, uA, uB; varying float vS; varying float vA;
  vec3 at(float ty){ float rad = mix(0.5, 1., ty) * aS.y; return vec3(cos(aS.x) * rad, -ty, sin(aS.x) * rad); }
  void main(){ float t = fract(aS.z + uT * (0.95 + 0.3 * aS.w)), t2 = t * (0.5 + 0.5 * t), l = 0.03 + 0.05 * t;
    vec4 p0 = modelViewMatrix * vec4(at(t2), 1.), p1 = modelViewMatrix * vec4(at(min(1., t2 + l)), 1.);
    vec2 d = normalize(p1.xy - p0.xy + vec2(1e-5, 0.));
    vec4 mv = mix(p0, p1, aE.x); mv.xy += vec2(-d.y, d.x) * aE.y * 0.0024;
    vS = aE.y; vA = uK * smoothstep(0., 0.03, t) * step(uA, t2) * step(t2, uB);
    gl_Position = projectionMatrix * mv; }`,
  `varying float vS; varying float vA; void main(){ float e = 1. - abs(vS);
  gl_FragColor = vec4(mix(vec3(0.5, 0.64, 0.76), vec3(1.), e), vA * (0.22 + 0.55 * e));` + END_FS);
// light steam: a few soft billboards rising and thinning out (unit column: radius 1, height 1)
const steamMat = () => fxMat('steam', `attribute vec3 aS; attribute vec2 aC; uniform float uT, uK; varying vec2 vC; varying float vA;
  void main(){ float t = fract(aS.z + uT * 0.1), sp = 0.55 + 0.9 * t;
    vec3 c = vec3(cos(aS.x) * aS.y * sp + 0.25 * sin(uT * 0.45 + aS.z * 19.) * t, t, sin(aS.x) * aS.y * sp);
    vec4 mv = modelViewMatrix * vec4(c, 1.); mv.xy += aC * (0.2 + 0.34 * t);
    vC = aC; vA = uK * sin(3.1416 * t); gl_Position = projectionMatrix * mv; }`,
  `varying vec2 vC; varying float vA; void main(){ float a = smoothstep(1., 0.05, length(vC));
  gl_FragColor = vec4(vec3(0.97), a * a * vA * 0.2);` + END_FS);
const fxDiscGeo = () => cg('fxDisc', () => new THREE.PlaneGeometry(2, 2).rotateX(-HALF));
function quadsGeo(key, n, per) {     // n quads; per(i, r) → per-quad attribute values {name: [..]}; aE / aC carry the corner
  return cg(key, () => {
    const r = rngM(n * 31 + key.length), g = new THREE.BufferGeometry(), attrs = {}, idx = [];
    for (let i = 0; i < n; i++) {
      const v = per(i, r);
      for (let c = 0; c < 4; c++) for (const [k, a] of Object.entries(v)) (attrs[k] ||= []).push(...(typeof a === 'function' ? a(c) : a));
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    }
    for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, new THREE.Float32BufferAttribute(a, a.length / (n * 4)));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 12), 3)); g.setIndex(idx);
    return g;
  });
}
const rainGeo = () => { const g = quadsGeo('fxRain', 230, (i, r) => ({ aS: [r() * 6.2832, Math.sqrt(r()), r(), r()], aE: (c) => [c >> 1, (c & 1) * 2 - 1] })); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.5, 0), 1.15); return g; };
const steamGeo = () => { const g = quadsGeo('fxSteam', 9, (i, r) => ({ aS: [r() * 6.2832, 0.25 + 0.75 * r(), i / 9 + r() * 0.05], aC: (c) => [(c & 1) * 2 - 1, (c >> 1) * 2 - 1] })); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.6); return g; };
// --- small sounds (WebAudio noise through a band-pass; only after a user gesture, like the walkthrough's clicks)
let SFX = null;
function sfx(kind) {
  try {
    if (typeof window === 'undefined') return null;
    const ua = navigator.userActivation; if (ua && !ua.hasBeenActive) return null;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    if (!SFX) { const ac = new AC(), n = ac.sampleRate, buf = ac.createBuffer(1, n, n), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; SFX = { ac, buf }; }
    const { ac, buf } = SFX; if (ac.state === 'suspended') ac.resume().catch(() => {});
    // [centre Hz, end Hz, Q, volume, attack s, hold s, release s]
    const [f0, f1, q, vol, att, hold, rel] = { tap: [3200, 3200, 0.6, 0.03, 0.15, 3, 3], bath: [1500, 1500, 0.5, 0.045, 0.2, 4, 3], shower: [4600, 4600, 0.4, 0.04, 0.3, 5, 4], flush: [1100, 320, 0.7, 0.1, 0.12, 1.9, 1.6], pump: [1300, 700, 1.2, 0.05, 0.01, 0.05, 0.1] }[kind];
    const t = ac.currentTime + 0.01, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; src.loop = true; f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + att + hold + rel);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.setValueAtTime(vol, t + att + hold); g.gain.linearRampToValueAtTime(0, t + att + hold + rel);
    src.connect(f).connect(g).connect(ac.destination); src.start(t); src.stop(t + att + hold + rel + 0.05);
    return { stop() { try { const n = ac.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + 0.15); src.stop(n + 0.2); } catch { /* already ended */ } } };
  } catch { return null; }
}
// --- a running outlet: a stream from the spout tip (x, y, z) falling `drop` onto a surface, with ripples there.
// o: {x, y, z, drop, r (stream thickness, 1 = basin tap), ring (ripple radius), snd}. Returns {toggle, proxy(...), running}.
function makeTapFx() {
  const g = new THREE.Group(); g.name = 'fx-tap';
  const stream = new THREE.Mesh(cg('islStream', () => new THREE.CylinderGeometry(0.0055, 0.0075, 1, 8, 1, true).translate(0, -0.5, 0)), streamMat());
  stream.raycast = NORAY; stream.renderOrder = 2;
  const st = g.userData.st = { t0: 0, tc: 0, len: 0.2, r: 1 };
  const ripple = fxMesh(fxDiscGeo(), rippleMat(), () => st.tc ? 0 : sat((sec() - st.t0 - 0.2) * 5));
  // opening: the stream grows down from the spout in 0.2 s; closing: its tail falls away in 0.16 s
  stream.onBeforeRender = () => {
    const now = sec(), w = st.r * (1 + 0.14 * Math.sin(now * 51));
    if (st.tc) { const k = sat((now - st.tc) / 0.16); stream.position.y = -st.len * k; stream.scale.set(w, Math.max(0.001, st.len * (1 - k)), w); }
    else { stream.position.y = 0; stream.scale.set(w, Math.max(0.001, st.len * sat((now - st.t0) / 0.2)), w); }
  };
  g.add(stream, ripple); g.userData.stream = stream; g.userData.ripple = ripple;
  return g;
}
function waterOutlet(dyn, m, piece, part, o) {
  let fx = null, running = false, timer = 0, rel = 0, snd = null;
  const proxies = [];
  const toggle = (on) => {
    const want = on === undefined ? !running : !!on; if (want === running) return Promise.resolve();
    running = want; clearTimeout(timer); clearTimeout(rel);
    for (const p of proxies) p.userData.open = p.userData._open = want;
    if (snd) { snd.stop(); snd = null; }
    if (want) {
      if (!fx) fx = fxTake('tap', makeTapFx);
      const st = fx.userData.st, rp = fx.userData.ripple; st.t0 = sec(); st.tc = 0; st.len = o.drop; st.r = o.r || 1;
      fx.userData.stream.scale.set(st.r, 0.001, st.r); fx.userData.stream.position.y = 0;
      rp.position.y = -o.drop + 0.002; rp.scale.setScalar(o.ring || 0.04); rp.userData.fx = { a: o.ring > 0.07 ? 22 : 14, b: 1 };
      fx.position.set(o.x, o.y, o.z); dyn.add(fx);
      snd = sfx(o.snd || 'tap');
      timer = setTimeout(() => toggle(false), WATER_AUTO_MS);
      return new Promise(res => setTimeout(res, 220));
    }
    if (fx) { fx.userData.st.tc = sec(); const f = fx; rel = setTimeout(() => { if (fx === f && !running) { fxGive('tap', f); fx = null; } }, 260); }
    return new Promise(res => setTimeout(res, 180));
  };
  return { toggle, get running() { return running; }, get fx() { return fx; },
    proxy: (w, h, d, x, y, z) => { const p = playProxy(dyn, m, piece, part, w, h, d, x, y, z, toggle); proxies.push(p); return p; } };
}
// --- shower: rain cone from the head (top centre x, y, z; floor radius R; fall H) + floor splashes + light steam
function makeShowerFx() {
  const g = new THREE.Group(); g.name = 'fx-shower';
  const st = g.userData.st = { t0: 0, tc: 0 };
  const win = () => { const now = sec(); return st.tc ? { a: sat((now - st.tc) / 0.55), b: 1 } : { a: 0, b: sat((now - st.t0) / 0.6) }; };
  const rain = fxMesh(rainGeo(), rainMat()); const rb = rain.onBeforeRender; rain.onBeforeRender = () => { rain.userData.fx = win(); rb(); };
  const splash = fxMesh(fxDiscGeo(), splashMat(), () => st.tc ? 1 - sat((sec() - st.tc - 0.3) / 0.4) : sat((sec() - st.t0 - 0.45) * 3));
  splash.userData.fx = { a: 7, b: 1 };
  const steam = fxMesh(steamGeo(), steamMat(), () => st.tc ? 1 - sat((sec() - st.tc) / 0.8) : sat((sec() - st.t0 - 1.5) / 5)); steam.renderOrder = 3;
  g.add(rain, splash, steam); Object.assign(g.userData, { rain, splash, steam });
  return g;
}
function showerOutlet(dyn, m, piece, o) {
  let fx = null, running = false, timer = 0, rel = 0, snd = null;
  const proxies = [];
  const toggle = (on) => {
    const want = on === undefined ? !running : !!on; if (want === running) return Promise.resolve();
    running = want; clearTimeout(timer); clearTimeout(rel);
    for (const p of proxies) p.userData.open = p.userData._open = want;
    if (snd) { snd.stop(); snd = null; }
    if (want) {
      if (!fx) fx = fxTake('shower', makeShowerFx);
      const { st, rain, splash, steam } = fx.userData; st.t0 = sec(); st.tc = 0;
      rain.position.set(0, 0, 0); rain.scale.set(o.R, o.H, o.R);
      splash.position.set(0, -o.H + 0.004, 0); splash.scale.setScalar(o.R * 1.25);
      steam.position.set(0, -o.H + 0.25, 0); steam.scale.set(o.R * 1.1, o.H - 0.1, o.R * 1.1);
      fx.position.set(o.x, o.y, o.z); dyn.add(fx);
      snd = sfx('shower');
      timer = setTimeout(() => toggle(false), WATER_AUTO_MS);
      return new Promise(res => setTimeout(res, 600));
    }
    if (fx) { fx.userData.st.tc = sec(); const f = fx; rel = setTimeout(() => { if (fx === f && !running) { fxGive('shower', f); fx = null; } }, 900); }
    return new Promise(res => setTimeout(res, 600));
  };
  return { toggle, get running() { return running; }, get fx() { return fx; },
    proxy: (w, h, d, x, y, z) => { const p = playProxy(dyn, m, piece, 'shower', w, h, d, x, y, z, toggle); proxies.push(p); return p; } };
}
// --- shampoo & shower gel: two pump bottles on a ledge (back at z = z0, ledge top at y). The bottles are static; their
// pump heads are one 2-instance mesh. A tap presses a pump: a thread of soap runs from the nozzle onto the ledge,
// gathers into a dollop, a few foam bubbles drift up and pop, and it all melts away.
const SOAPS = [['#d2a55c', '#fbf2de', 'shampoo'], ['#6f9a94', '#bfe8dd', 'gel']];
const pumpGeo = () => cg('pumpHead', () => {
  const parts = [new THREE.CylinderGeometry(0.004, 0.004, 0.034, 8).translate(0, 0.017, 0), new THREE.CylinderGeometry(0.012, 0.013, 0.01, 12).translate(0, 0.037, 0),
    new THREE.BoxGeometry(0.009, 0.007, 0.046).translate(0, 0.038, 0.029), new THREE.BoxGeometry(0.008, 0.01, 0.007).translate(0, 0.0335, 0.0485)];
  const out = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p)); parts.forEach(p => p.dispose()); return out;
});
function makeGelFx() {
  const im = new THREE.InstancedMesh(cg('islFood', () => { const sg3 = new THREE.SphereGeometry(1, 14, 9); sg3.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sg3.attributes.position.count * 3).fill(1), 3)); return sg3; }), undefined, 8);
  im.name = 'fx-gel'; im.raycast = NORAY; im.frustumCulled = false;
  const st = im.userData.st = { t0: 0, drop: 0.03, col: new THREE.Color() }, M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), W = new THREE.Color('#ffffff');
  const set = (i, x, y, z, sx, sy, sz) => { M.compose(P.set(x, y, z), Q, S.set(Math.max(1e-5, sx), Math.max(1e-5, sy), Math.max(1e-5, sz))); im.setMatrixAt(i, M); };
  const rr = rngM(5), BUB = Array.from({ length: 6 }, (_, i) => [rr() * 6.28, 0.3 + 0.5 * i / 6 + rr() * 0.2, 0.005 + rr() * 0.005, 0.035 + rr() * 0.06, 1.0 + rr() * 0.7]);
  im.userData.paint = () => { im.setColorAt(0, st.col); im.setColorAt(1, st.col); for (let i = 2; i < 8; i++) im.setColorAt(i, W); im.instanceColor.needsUpdate = true; };
  // origin = the nozzle tip; t in seconds since the press
  im.onBeforeRender = () => {
    const t = sec() - st.t0, d = st.drop, out = 1 - sat((t - 2.5) / 0.5);
    const grow = sat((t - 0.16) / 0.55), fall = sat((t - 0.06) / 0.12), cut = sat((t - 0.62) / 0.14);     // thread: reaches the ledge, then its top lets go
    const top = -d * cut, bot = -d * fall, len = Math.max(0, top - bot);
    set(0, 0, (top + bot) / 2, 0, 0.0036, len / 2, 0.0036);
    const R = 0.019 * Math.sqrt(grow) * out; set(1, 0, -d + R * 0.5, 0, R * 1.3, R * 0.62, R * 1.3);
    BUB.forEach(([a, tb, r, h, life], i) => {
      const k = sat((t - tb) / life), s = k <= 0 || k >= 1 ? 0 : r * Math.min(1, k * 6) * (k > 0.88 ? (1 - k) / 0.12 : 1) * out;
      set(2 + i, Math.cos(a) * (0.008 + 0.016 * k), -d + 0.012 + h * k * (2 - k), Math.sin(a) * (0.006 + 0.01 * k) + 0.004, s, s, s);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  return im;
}
function soapLedge(g, dyn, m, piece, x, y, z0, o = {}) {
  const s = m.fam, n = SOAPS.length, zb = z0 + 0.042, heads = [];
  if (o.ledge !== false) box(g, o.w || 0.3, 0.014, 0.125, s === 'milano' ? m.brass : m.stone, x, y - 0.014, z0 + 0.0625);
  const pumps = new THREE.InstancedMesh(pumpGeo(), m.tap, n); pumps.name = piece + '-pumps'; pumps.raycast = NORAY; dyn.add(pumps);
  const M = new THREE.Matrix4();
  SOAPS.forEach(([hex, soap], i) => {
    const bx = x + (i - (n - 1) / 2) * 0.085, h = 0.13 + i * 0.012;
    tint(lathe(g, [[0, 0], [0.027, 0], [0.029, 0.01], [0.029, h - 0.03], [0.024, h - 0.012], [0.012, h - 0.004], [0.012, h + 0.006], [0, h + 0.006]], m.goods, bx, y, zb, 16), hex);
    tint(cyl(g, 0.0295, 0.0295, 0.045, m.goods, bx, y + h * 0.3, zb, 16, null, true), '#f6f1e6');                       // label band
    const hd = { x: bx, y: y + h + 0.006, z: zb, t0: -9, fx: null, rel: 0, col: soap, px: null }; heads.push(hd);
    pumps.setMatrixAt(i, M.makeTranslation(hd.x, hd.y, hd.z));
    hd.px = playProxy(dyn, m, piece, 'shampoo', 0.08, h + 0.07, 0.11, bx, y, zb + 0.015, () => {
      hd.t0 = sec(); clearTimeout(hd.rel); hd.px.userData.open = hd.px.userData._open = true;
      if (!hd.fx) { hd.fx = fxTake('gel', makeGelFx); hd.fx.material = m.food; }
      const st = hd.fx.userData.st; st.t0 = hd.t0; st.drop = hd.y + 0.0335 - 0.006 - y; st.col.set(hd.col); hd.fx.userData.paint();
      hd.fx.position.set(hd.x, hd.y + 0.0335 - 0.006, hd.z + 0.0485); hd.fx.onBeforeRender(); dyn.add(hd.fx);
      sfx('pump');
      hd.rel = setTimeout(() => { if (hd.fx) { fxGive('gel', hd.fx); hd.fx = null; } hd.px.userData.open = hd.px.userData._open = false; }, 3100);
      return new Promise(res => setTimeout(res, 300));
    });
    hd.px.userData.soap = SOAPS[i][2];
  });
  // the pump heads dip 12 mm and spring back
  pumps.onBeforeRender = () => {
    const now = sec(); let any = false;
    heads.forEach((hd, i) => { const t = now - hd.t0; if (t > 0.9 && !hd.down) return; const k = t < 0.1 ? t / 0.1 : t < 0.42 ? 1 : Math.max(0, 1 - (t - 0.42) / 0.25); hd.down = k > 0; pumps.setMatrixAt(i, M.makeTranslation(hd.x, hd.y - 0.012 * k, hd.z)); any = true; });
    if (any) pumps.instanceMatrix.needsUpdate = true;
  };
  return { heads, pumps };
}

// ================================================================== BATH
// Wall-hung pan, back at z = 0 (against the wall), bowl extends to +z. The bowl is hollow with standing water; the lid
// is hinged (tap the pan: it lifts / soft-closes) and the flush plate on the wall flushes: foam spirals down the bowl,
// the water drops away and refills.
const LID_OPEN = 1.53;
function makeSwirlFx() {
  const st = { t0: 0 };
  const o = fxMesh(cg('fxSwirl', () => new THREE.LatheGeometry([[0.1265, 0.386], [0.1135, 0.3], [0.0765, 0.2255], [0.045, 0.2], [0.001, 0.197]].map(([a, b]) => new THREE.Vector2(a, b)), 36)), swirlMat(),
    () => { const t = sec() - st.t0; return sat(t / 0.25) * (1 - sat((t - 2.7) / 0.9)); });
  o.userData.st = st; o.name = 'fx-swirl';
  return o;
}
function toilet(m, o = {}) {
  const g = new THREE.Group(), SZ = 1.39, bz = 0.3;          // bowl plan 0.36 × 0.50: a lathe stretched along z
  soft(g, 0.36, 0.3, 0.16, m.porcelain, 0, 0.1, 0.08, null, { e: [0.3, 0.3, 0.3], seg: 20 });
  lathe(g, [[0.001, 0.1], [0.1, 0.1], [0.155, 0.17], [0.178, 0.3], [0.18, 0.395], [0.176, 0.402], [0.135, 0.402], [0.128, 0.385], [0.115, 0.3], [0.078, 0.225], [0.04, 0.195], [0.001, 0.19]], m.porcelain, 0, 0, bz, 36, [1, 1, SZ]);
  lathe(g, [[0.127, 0.402], [0.186, 0.402], [0.188, 0.412], [0.184, 0.421], [0.131, 0.421], [0.126, 0.412], [0.127, 0.402]], m.porcelain, 0, 0, bz, 36, [1, 1, SZ]);   // seat
  for (const sx of [-1, 1]) rod(g, 0.008, 0.03, m.chrome, sx * 0.075, 0.43, 0.058, [0, 0, HALF], 8);                 // lid hinges
  fxFlat(g, m.aoSoft, 'disc', 0, 0.012, 0.28, 0.5, 0.62);
  // flush plate on the wall
  box(g, 0.24, 0.16, 0.012, m.fam === 'nordic' ? m.blackMetal : m.brass, 0, 0.95, 0.006);
  box(g, 0.1, 0.13, 0.004, m.fam === 'nordic' ? m.darkPlastic : m.chrome, -0.055, 0.965, 0.013);
  // toilet roll holder
  rod(g, 0.006, 0.14, m.tap, 0.36, 0.72, 0.08, [0, 0, HALF]);
  cyl(g, 0.055, 0.055, 0.1, m.linen, 0.36, 0.67, 0.08, 16, [0, 0, HALF]);
  g.userData.solidBox = { w: 0.4, d: 0.6, h: 0.45, z: 0.3 };
  // ---- interactive (unbaked): lid, the water in the bowl (drawn only while the lid is up), the flush
  const dyn = playGroup(g, 'toilet-dyn');
  const piv = grp(dyn, 0, 0.424, 0.058);
  const lid = soft(piv, 0.375, 0.028, 0.5, m.porcelain, 0, 0, 0.245, null, { e: [0.5, 0.6, 0.55], seg: 22 }); lid.raycast = NORAY; lid.name = 'toilet-lid';
  const bw = grp(dyn, 0, 0, bz); bw.scale.z = SZ; bw.visible = false; bw.name = 'toilet-water';
  const WY = 0.262, lvl = { t0: -99, live: false };
  const rAt = (y) => y >= 0.225 ? 0.078 + (y - 0.225) / 0.075 * 0.037 : 0.04 + (y - 0.195) / 0.03 * 0.038;   // inner bowl radius at height y
  const water = new THREE.Mesh(cg('fxCirc', () => new THREE.CircleGeometry(1, 32).rotateX(-HALF)), bowlWaterMat());
  water.raycast = NORAY; water.renderOrder = 2; water.position.y = WY; water.scale.set(rAt(WY) - 0.001, 1, rAt(WY) - 0.001); bw.add(water);
  water.onBeforeRender = () => {
    const t = sec() - lvl.t0; if (t > 5.2 && !lvl.live) return;
    const dy = t < 0.4 ? 0.006 * t / 0.4 : t < 1.9 ? 0.006 - 0.05 * easeIO((t - 0.4) / 1.5) : t < 2.5 ? -0.044 : -0.044 * (1 - easeIO(sat((t - 2.5) / 2.4)));
    lvl.live = t <= 5.2; const y = WY + dy, r = rAt(y) - 0.001; water.position.y = y; water.scale.set(r, 1, r);
  };
  let open = false, tok = 0, swirl = null;
  const st = { get open() { return open; }, get flushing() { return sec() - lvl.t0 < 5.2; }, lid: piv, water: bw, parts: {} };
  const setLid = (on) => {
    const want = on === undefined ? !open : !!on; if (want === open) return Promise.resolve();
    open = want; const my = ++tok, a0 = piv.rotation.x, a1 = want ? -LID_OPEN : 0;
    for (const p of [lidPx, upPx]) p.userData.open = p.userData._open = want;
    upPx.raycast = want ? THREE.Mesh.prototype.raycast : NORAY;
    if (want) bw.visible = true;
    return tweenMs(Math.max(160, 650 * Math.abs(a1 - a0) / LID_OPEN), k => { if (my !== tok) return; piv.rotation.x = a0 + (a1 - a0) * easeIO(k); if (k === 1 && !want) bw.visible = false; });
  };
  const flush = () => {
    if (st.flushing) return Promise.resolve();
    lvl.t0 = sec(); lvl.live = true; flushPx.userData.open = flushPx.userData._open = true;
    if (!swirl) swirl = fxTake('swirl', makeSwirlFx);
    swirl.userData.st.t0 = lvl.t0; bw.add(swirl);
    sfx('flush');
    setTimeout(() => { if (swirl) { fxGive('swirl', swirl); swirl = null; } flushPx.userData.open = flushPx.userData._open = false; }, 3800);
    return new Promise(res => setTimeout(res, 300));
  };
  // the pan's proxy stands a little proud of the furniture collider; the raised lid gets its own (to close it again)
  const lidPx = playProxy(dyn, m, 'toilet', 'toiletLid', 0.43, 0.19, 0.62, 0, 0.3, 0.31, setLid);
  const upPx = playProxy(dyn, m, 'toilet', 'toiletLid', 0.42, 0.46, 0.09, 0, 0.46, 0.045, setLid); upPx.raycast = NORAY;
  const flushPx = playProxy(dyn, m, 'toilet', 'flush', 0.27, 0.19, 0.05, 0, 0.935, 0.025, flush);
  st.parts = { lid: lidPx, lidUp: upPx, flush: flushPx };
  g.userData.toilet = dyn.userData.toilet = st;
  return g;
}
function vanity(m, o = {}) {           // floating vanity, back at z=0, basin(s) facing +z
  const L = o.len || 1.0, s = m.fam, g = new THREE.Group(), H = 0.86, D = 0.5;
  const paris = m.styleId === 'paris';
  const body = paris ? m.lacquer : s === 'nordic' ? m.woodLight : s === 'milano' ? m.woodDark : m.woodDark, inM = m.cabinetIn;
  // paris: a washstand — the painted body stands on turned brass legs with a brass towel bar between them
  if (paris) { for (const sx of [-1, 1]) { cyl(g, 0.016, 0.011, H - 0.4, m.brass, sx * (L / 2 - 0.04), 0, D - 0.07, 12); cyl(g, 0.016, 0.011, H - 0.4, m.brass, sx * (L / 2 - 0.04), 0, 0.05, 12); } rod(g, 0.008, L - 0.08, m.brass, 0, 0.2, D - 0.07, [0, 0, HALF], 8); }
  // floating body: shell around one or two full-height drawers (towels, toiletries)
  const yb = H - 0.4, bh = 0.36, zb0 = 0.01, zf = D - 0.03, zm = (zb0 + zf) / 2;
  box(g, L, 0.018, zf - zb0, body, 0, yb, zm);
  for (const sx of [-1, 1]) box(g, 0.018, bh, zf - zb0, body, sx * (L / 2 - 0.009), yb, zm);
  box(g, L - 0.036, bh, 0.016, inM, 0, yb, zb0 + 0.008);
  box(g, L - 0.036, 0.018, zf - zb0, inM, 0, yb + bh - 0.018, zm);
  const nd = L > 1.3 ? 2 : 1, dw = (L - 0.012) / nd, W = (WEAR[m.styleId] || WEAR[s]);
  for (let k = 0; k < nd; k++) {
    const xm = -L / 2 + 0.006 + dw * (k + 0.5), dr = drawerMv(g, xm, yb + 0.004, zf, 0.3);
    box(dr, dw - 0.006, bh - 0.008, 0.02, body, 0, 0, 0.01);
    if (paris) { shaker(dr, m, dw - 0.006, bh - 0.008, 0, 0, 0.0205); sph(dr, 0.015, m.brass, 0, (bh - 0.008) / 2, 0.034, [1, 1, 0.8], 10); }
    else if (s === 'riviera') box(dr, dw - 0.08, 0.28, 0.006, m.cane, 0, 0.04, 0.023);
    else box(dr, dw - 0.01, 0.005, 0.005, s === 'milano' ? m.brass : m.blackMetal, 0, bh - 0.084, 0.0225);
    const bw = dw - 0.07, bd = zf - zb0 - 0.05, dh = 0.2;
    box(dr, bw, 0.01, bd, inM, 0, 0.03, -bd / 2 - 0.005);
    for (const sx of [-1, 1]) box(dr, 0.012, dh, bd, inM, sx * (bw / 2 - 0.006), 0.03, -bd / 2 - 0.005);
    box(dr, bw, dh, 0.012, inM, 0, 0.03, -bd);
    // rolled towels at the back, toiletries at the front
    const c = grp(dr, 0, 0.04, -0.01), r = rngM(k * 7 + 5);
    for (let i = 0; i < 3; i++) towelRoll(c, m, -bw / 2 + 0.17 + (i % 2) * 0.01, 0, -bd + 0.07 + i * 0.1, i % 2 ? m.towel2 : m.towel, Math.min(0.3, bw - 0.1));
    const kinds = ['pump', 'tube', 'jar', 'perfume', 'tube', 'jar'], cols = [...W.shirts.slice(0, 2), ...W.warm.slice(0, 3), W.bags[1]];
    for (let i = 0, x = -bw / 2 + 0.05; x < bw / 2 - 0.05 && i < 7; i++, x += 0.07) {
      const kd = kinds[i % kinds.length];
      if (kd === 'tube') { const tg = grp(c, x, 0.013, -0.1, 0.2); tg.rotation.x = -HALF; toiletry(tg, m, 0, 0, 0, cols[i % cols.length], 'tube', 0.14); }
      else toiletry(c, m, x, 0, -0.08 - r() * 0.04, cols[i % cols.length], kd, 0.15);
    }
  }
  box(g, L, 0.04, D + 0.01, m.counter, 0, H - 0.04, D / 2);
  const basins = L > 1.3 ? [-L / 4, L / 4] : [0];
  // every basin tap runs: [x, tap z, tap height, where the stream lands (above the counter)]
  const outs = [], dyn = playGroup(g, 'vanity-dyn');
  for (const bx of basins) {
    if (m.styleId === 'kyoto') {
      // carved travertine vessel basin (thick rim, honed) with a bronze wall-style spout
      lathe(g, [[0.001, 0], [0.17, 0], [0.2, 0.06], [0.21, 0.13], [0.19, 0.135], [0.17, 0.07], [0.12, 0.035], [0.001, 0.03]], m.stone, bx, H, D / 2 + 0.04, 32);
      tap(g, m, bx, H, 0.06, 0.32); outs.push([bx, 0.06, 0.32, 0.036]);
      continue;
    }
    if (m.styleId === 'monaco') {
      // Calacatta Oro vessel bowl on the Nero counter, brass tap
      lathe(g, [[0.001, 0], [0.11, 0], [0.18, 0.06], [0.2, 0.14], [0.19, 0.145], [0.165, 0.08], [0.1, 0.03], [0.001, 0.025]], m.marble, bx, H, D / 2 + 0.05, 32);
      torus(g, 0.196, 0.006, m.brass, bx, H + 0.143, D / 2 + 0.05, [HALF, 0, 0], Math.PI * 2, 32);
      tap(g, m, bx, H, 0.08, 0.34); outs.push([bx, 0.08, 0.34, 0.03]);
      continue;
    }
    // nordic: a low oval countertop basin
    if (s === 'nordic') lathe(g, [[0.001, 0], [0.13, 0], [0.185, 0.03], [0.2, 0.085], [0.192, 0.09], [0.178, 0.04], [0.12, 0.016], [0.001, 0.014]], m.porcelain, bx, H, D / 2 + 0.03, 32, [1.12, 1, 0.8]);
    else lathe(g, [[0, 0], [0.12, 0], [0.19, 0.08], [0.2, 0.14], [0.19, 0.14], [0.17, 0.09], [0.001, 0.02]], s === 'milano' ? m.porcelain : m.ceramic, bx, H, D / 2 + 0.05, 28);
    tap(g, m, bx, H, 0.08, s === 'nordic' ? 0.22 : 0.3); outs.push([bx, 0.08, s === 'nordic' ? 0.22 : 0.3, s === 'nordic' ? 0.017 : 0.047]);
  }
  g.userData.taps = dyn.userData.taps = outs.map(([bx, tz, th, land]) => {
    const out = waterOutlet(dyn, m, 'vanity', 'tap', { x: bx, y: H + th - 0.06, z: tz + 0.16, drop: th - 0.06 - land, ring: 0.045 });
    out.proxy(0.16, 0.21, 0.3, bx, H, tz + 0.09);       // kept below the mirror cabinet's door
    return out;
  });
  // accessories
  lathe(g, [[0, 0], [0.03, 0], [0.03, 0.14], [0.012, 0.16], [0.006, 0.19], [0, 0.19]], s === 'milano' ? m.ceramic2 : m.ceramic, L / 2 - 0.1, H, 0.12, 12);
  lathe(g, [[0, 0], [0.035, 0], [0.035, 0.1], [0, 0.1]], m.bottle, L / 2 - 0.2, H, 0.1, 12);
  tray(g, m, -L / 2 + 0.16, H, 0.14, 0.2, 0.14);
  sph(g, 0.03, m.ceramic, -L / 2 + 0.12, H + 0.025, 0.14, [1.3, 0.6, 1], 10);
  // folded towel stack (rounded folds)
  soft(g, 0.3, 0.055, 0.21, m.towel, L / 2 - 0.2, H, D - 0.13, null, { e: [0.12, 0.7, 0.3], seg: 16 });
  soft(g, 0.3, 0.05, 0.2, m.towel, L / 2 - 0.2, H + 0.05, D - 0.13, [0, 0.05, 0], { e: [0.12, 0.7, 0.3], seg: 16 });
  soft(g, 0.28, 0.048, 0.19, m.towel2, L / 2 - 0.2, H + 0.097, D - 0.13, [0, -0.04, 0], { e: [0.12, 0.7, 0.3], seg: 16 });
  g.userData.solidBox = { w: L, d: D, h: H, z: D / 2 };
  return g;
}
// Bathroom mirror cabinet in the style's mirror shape (milano rectangle, nordic round, riviera arch): shallow
// carcass with glass shelves, hinged mirror door(s); bottles, perfume, creams, toothbrushes + LED appear when opened.
function mirrorCabinet(m, o = {}) {
  const W = o.w || 0.8, H = o.h || 0.9, s = m.fam, g = new THREE.Group(), Dp = 0.13, inM = m.cabinetIn;
  const fm = s === 'nordic' ? m.blackMetal : m.brass;
  const R = W / 2, spring = H - W / 2;
  const halfW = (y) => s === 'nordic' ? Math.sqrt(Math.max(0, R * R - (y - R) * (y - R))) : s === 'riviera' && y > spring ? Math.sqrt(Math.max(0, R * R - (y - spring) * (y - spring))) : W / 2;
  const shelfY = s === 'nordic' ? [H * 0.3, H * 0.62] : [H * 0.3, H * 0.6];
  if (s === 'milano') {
    shell(g, inM, W, H, Dp, 0, 0, Dp / 2, 0.014);
    for (const sx of [-1, 1]) box(g, 0.006, H + 0.012, Dp, fm, sx * (W / 2 + 0.003), -0.006, Dp / 2);
    for (const y of [-0.006, H]) box(g, W + 0.012, 0.006, Dp, fm, 0, y, Dp / 2);
  } else if (s === 'nordic') {
    add(g, cg(`mcR${r3(R)}`, () => new THREE.CylinderGeometry(R, R, Dp, 48, 1, true)), fm, 0, R, Dp / 2, [HALF, 0, 0]);
    add(g, cg(`mcRi${r3(R)}`, () => new THREE.LatheGeometry([new THREE.Vector2(R - 0.004, Dp), new THREE.Vector2(R - 0.004, 0.014)], 48)), inM, 0, R, 0, [HALF, 0, 0]);
    disc(g, R - 0.004, inM, 0, R, 0.016, [0, 0, 0], 48);
  } else {
    const ring = cg(`mcA${r3(W)}|${r3(H)}`, () => {
      const sh = new THREE.Shape(); sh.moveTo(-R, 0); sh.lineTo(R, 0); sh.lineTo(R, spring); sh.absarc(0, spring, R, 0, PI_, false); sh.lineTo(-R, 0);
      const r2 = R - 0.012, hl = new THREE.Path(); hl.moveTo(-r2, 0.012); hl.lineTo(r2, 0.012); hl.lineTo(r2, spring); hl.absarc(0, spring, r2, 0, PI_, false); hl.lineTo(-r2, 0.012); sh.holes.push(hl);
      return new THREE.ExtrudeGeometry(sh, { depth: Dp, bevelEnabled: false, curveSegments: 24 });
    });
    add(g, ring, fm, 0, 0, 0);
    add(g, cg(`mcAb${r3(W)}|${r3(H)}`, () => { const sh = new THREE.Shape(), r2 = R - 0.012; sh.moveTo(-r2, 0.012); sh.lineTo(r2, 0.012); sh.lineTo(r2, spring); sh.absarc(0, spring, r2, 0, PI_, false); sh.lineTo(-r2, 0.012); return new THREE.ShapeGeometry(sh, 24); }), inM, 0, 0, 0.016);
  }
  for (const y of shelfY) { const hw = halfW(y) - 0.02; box(g, hw * 2, 0.006, Dp - 0.03, m.glass, 0, y, Dp / 2 - 0.005); }
  const comp = compartment(g, (c) => {
    const W2 = (WEAR[m.styleId] || WEAR[s]), cols = [W2.shirts[0], W2.warm[0], W2.bags[2], W2.warm[3], W2.shirts[1], W2.dark[1]];
    const bands = [s === 'nordic' ? H * 0.12 : 0.014, ...shelfY.map(y => y + 0.006)];
    bands.forEach((y, bi) => {
      const hw = Math.min(halfW(y + 0.02), halfW(y + 0.12)) - 0.04;
      const kinds = bi === 0 ? ['cup', 'pump', 'jar', 'tube'] : bi === 1 ? ['perfume', 'jar', 'pump', 'perfume'] : ['tube', 'jar', 'perfume', 'pump'];
      for (let i = 0, x = -hw + 0.03; x < hw - 0.02 && i < 6; i++, x += 0.075) {
        const kd = kinds[i % kinds.length];
        if (kd === 'cup') { tumbler(c, m, x, y, Dp / 2); for (const k of [-1, 1]) tint(rod(c, 0.005, 0.17, m.goods, x + k * 0.01, y + 0.1, Dp / 2, [k * 0.12, 0, 0], 6), cols[(i + k + 2) % cols.length]); }
        else toiletry(c, m, x, y, Dp / 2 - 0.005, cols[(i + bi) % cols.length], kd, 0.13);
      }
    });
    fxQuad(c, m.glow, s === 'milano' ? 'grad' : 'disc', [0, H / 2, 0.006], [W * 0.95, 0, 0], [0, H * 0.95, 0]);
    box(c, W * 0.6, 0.006, 0.01, m.led, 0, s === 'nordic' ? H * 0.82 : H - 0.03, Dp - 0.02);
  });
  // door(s): mirror + thin frame, hinged at the outer edge(s)
  const doorsN = s === 'milano' && W > 0.7 ? 2 : 1;
  if (s === 'milano') {
    for (let k = 0; k < doorsN; k++) {
      const x0 = -W / 2 + k * W / doorsN, x1 = x0 + W / doorsN, side = doorsN === 2 ? (k ? 1 : -1) : -1;
      const dr = hinged(g, x0, x1, -0.02, Dp, side, comp), cx = dr.userData.cx, dw = x1 - x0;
      box(dr, dw - 0.002, H + 0.04, 0.012, fm, cx, 0, 0.006);
      box(dr, dw - 0.03, H, 0.004, m.mirror, cx, 0.02, 0.014);
    }
  } else if (s === 'nordic') {
    const dr = hinged(g, -R, R, 0, Dp, -1, comp);
    add(dr, cg(`mcD${r3(R)}`, () => new THREE.CylinderGeometry(R, R, 0.016, 48)), fm, R, R, 0.008, [HALF, 0, 0]);
    add(dr, cg(`mcM${r3(R)}`, () => new THREE.CylinderGeometry(R - 0.015, R - 0.015, 0.004, 48)), m.mirror, R, R, 0.018, [HALF, 0, 0]);
  } else {
    const dr = hinged(g, -R, R, 0, Dp, -1, comp);
    add(dr, cg(`archF${r3(W)}|${r3(H)}`, () => { const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(W / 2, H - W / 2); sh.absarc(0, H - W / 2, W / 2, 0, Math.PI, false); sh.lineTo(-W / 2, 0); return new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false, curveSegments: 20 }); }), fm, R, 0, 0);
    add(dr, cg(`archM${r3(W)}|${r3(H)}`, () => { const s2 = new THREE.Shape(); const w = W - 0.03, h = H - 0.03; s2.moveTo(-w / 2, 0.015); s2.lineTo(w / 2, 0.015); s2.lineTo(w / 2, h - w / 2); s2.absarc(0, h - w / 2 + 0.0, w / 2, 0, Math.PI, false); s2.lineTo(-w / 2, 0.015); return new THREE.ShapeGeometry(s2, 20); }), m.mirror, R, 0, 0.021);
  }
  g.userData.noSolid = true;
  return g;
}
const PI_ = Math.PI;
function mirror(m, o = {}) {           // wall mirror, back at z=0
  if (o.cabinet) return mirrorCabinet(m, o);
  const W = o.w || 0.8, H = o.h || 0.9, s = m.fam, g = new THREE.Group();
  if (s === 'riviera') {
    // arched mirror in thin brass
    const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(W / 2, H - W / 2); sh.absarc(0, H - W / 2, W / 2, 0, Math.PI, false); sh.lineTo(-W / 2, 0);
    const geoF = cg(`archF${r3(W)}|${r3(H)}`, () => new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false, curveSegments: 20 }));
    const geoM = cg(`archM${r3(W)}|${r3(H)}`, () => { const s2 = new THREE.Shape(); const w = W - 0.03, h = H - 0.03; s2.moveTo(-w / 2, 0.015); s2.lineTo(w / 2, 0.015); s2.lineTo(w / 2, h - w / 2); s2.absarc(0, h - w / 2 + 0.0, w / 2, 0, Math.PI, false); s2.lineTo(-w / 2, 0.015); return new THREE.ShapeGeometry(s2, 20); });
    add(g, geoF, m.brass, 0, 0, 0);
    add(g, geoM, m.mirror, 0, 0, 0.021);
  } else if (s === 'milano') {
    box(g, W + 0.04, H + 0.04, 0.03, m.brass, 0, -0.02, 0.015);
    box(g, W, H, 0.004, m.mirror, 0, 0, 0.032);
  } else {
    const t = cyl(g, W / 2, W / 2, 0.02, m.blackMetal, 0, 0, 0, 40, [HALF, 0, 0]); t.position.set(0, H / 2, 0.01);
    const mm = cyl(g, W / 2 - 0.015, W / 2 - 0.015, 0.004, m.mirror, 0, 0, 0, 40, [HALF, 0, 0]); mm.position.set(0, H / 2, 0.022);
  }
  g.userData.noSolid = true;
  return g;
}
function sconce(p, m, x, y, z) {
  const g = grp(p, x, y, z);
  cyl(g, 0.035, 0.035, 0.015, m.metal, 0, 0, 0.0075, 16, [HALF, 0, 0]);
  rod(g, 0.006, 0.1, m.metal, 0, 0, 0.05, [HALF, 0, 0]);
  if (m.fam === 'nordic') cyl(g, 0.06, 0.06, 0.12, m.lampShade, 0, -0.06, 0.12, 20, null, true);
  else if (m.styleId === 'paris') { sph(g, 0.065, m.opal, 0, 0.03, 0.12, [1, 1, 1], 18); cyl(g, 0.02, 0.026, 0.03, m.metal, 0, -0.05, 0.12, 12); }
  else sph(g, 0.06, m.lampShade, 0, 0, 0.12, [1, 1, 1], 16);
  fxWallZ(g, m.lampGlow, 'lamp', 0, 0, 0.004, 0.6, 1.1);
  bloom(g, 0, 0, 0.12, 0.45, 0.5);
  return g;
}
// Every tub has a filler that runs (tap it) and a ledge on the wall behind it with the shampoo & shower-gel pumps.
// Floor-standing fillers stand in the back corner beside the tub's rounded end (clear of the side wall and of a
// neighbouring shower), turned FILLER_RY so the spout reaches over the water.
const FILLER_RY = 0.835, FILLER_DX = Math.cos(FILLER_RY), FILLER_DZ = Math.sin(FILLER_RY);
function bathPlay(g, m, L, tip, yWater, px, cut) {
  const dyn = playGroup(g, 'bath-dyn');
  const out = waterOutlet(dyn, m, 'bathtub', 'bathTap', { x: tip[0], y: tip[1], z: tip[2], drop: tip[1] - yWater, r: 1.9, ring: 0.1, snd: 'bath' });
  out.proxy(...px);
  const soap = soapLedge(g, dyn, m, 'bathtub', -L / 2 + 0.34, cut ? 0.8 : 1.02, 0.004);     // (below the dollhouse cut line)
  g.userData.bath = dyn.userData.bath = { filler: out, soap };
}
function bathtub(m, o = {}) {          // along x, length 1.7, back to z = 0 wall
  const L = o.len || 1.7, W = 0.78, s = m.fam, g = new THREE.Group();
  if (m.styleId === 'monaco') {
    // freestanding oval tub: Nero Marquina outer shell, white glazed interior, polished brass rim; brass floor filler
    const gg = grp(g, 0, 0, W / 2); gg.scale.set(L / W, 1, 1);
    lathe(gg, [[0, 0], [W * 0.36, 0], [W * 0.47, 0.18], [W * 0.5, 0.56], [W * 0.505, 0.6]], m.marbleDark, 0, 0, 0, 44);
    lathe(gg, [[W * 0.5, 0.602], [W * 0.455, 0.6], [W * 0.42, 0.24], [W * 0.3, 0.12], [0.001, 0.12]], m.porcelain, 0, 0.001, 0, 44);
    torus(gg, W * 0.488, 0.012, m.brass, 0, 0.603, 0, [HALF, 0, 0], Math.PI * 2, 48);
    disc(gg, W * 0.445, m.water, 0, 0.47, 0, [-HALF, 0, 0], 40);
    const f = grp(g, L / 2 - 0.12, 0, 0.08, FILLER_RY);      // floor filler in the back corner, spout swung over the water
    rod(f, 0.018, 0.92, m.brass, 0, 0.46, 0); torus(f, 0.15, 0.016, m.brass, -0.15, 0.92, 0, [0, 0, 0], Math.PI, 16);
    cyl(f, 0.06, 0.07, 0.025, m.brass, 0, 0, 0, 20); rod(f, 0.01, 0.12, m.brass, 0.03, 0.75, 0, [0, 0, -1.2], 8);
    const bt = grp(g, 0.1, 0.62, W / 2);
    box(bt, 0.14, 0.018, W + 0.06, m.brass, 0, 0, 0);
    candle(bt, m, 0.0, 0.018, -0.18, 0.08); glass(bt, m, 0, 0.018, 0.1, 'wine', true);
    g.userData.solidBox = { w: L, d: W, h: 0.6, z: W / 2 };
    bathPlay(g, m, L, [L / 2 - 0.12 - 0.3 * FILLER_DX, 0.918, 0.08 + 0.3 * FILLER_DZ], 0.472, [0.4, 0.55, 0.42, L / 2 - 0.2, 0.6, 0.21], o.cut);
    return g;
  }
  if (m.styleId === 'paris') {
    // cast-iron clawfoot tub: white enamel inside and out, rolled rim, four brass ball-and-claw feet,
    // a brass floor-standing "telephone" filler with a hand shower, and a brass bath rack
    const yT = 0.13, gg = grp(g, 0, yT, W / 2); gg.scale.set(L / W, 1, 1);
    lathe(gg, [[0.001, 0], [W * 0.3, 0.012], [W * 0.43, 0.14], [W * 0.485, 0.42], [W * 0.5, 0.47]], m.porcelain, 0, 0, 0, 44);
    lathe(gg, [[W * 0.5, 0.472], [W * 0.455, 0.465], [W * 0.42, 0.2], [W * 0.3, 0.08], [0.001, 0.07]], m.porcelain, 0, 0.001, 0, 44);
    torus(gg, W * 0.492, 0.022, m.porcelain, 0, 0.47, 0, [HALF, 0, 0], Math.PI * 2, 48);
    disc(gg, W * 0.44, m.water, 0, 0.37, 0, [-HALF, 0, 0], 40);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const fx = sx * L * 0.3, fz = W / 2 + sz * W * 0.24;
      lathe(g, [[0.001, 0], [0.04, 0.004], [0.046, 0.03], [0.03, 0.055], [0.026, 0.09], [0.04, 0.13], [0.055, 0.17], [0.001, 0.19]], m.brass, fx, 0, fz, 14);
    }
    const f = grp(g, L / 2 - 0.12, 0, 0.1, FILLER_RY);
    for (const sz of [-1, 1]) { rod(f, 0.012, 0.86, m.brass, 0, 0.43, sz * 0.07, null, 10); cyl(f, 0.035, 0.04, 0.02, m.brass, 0, 0, sz * 0.07, 14); sph(f, 0.022, m.brass, 0, 0.86, sz * 0.07, [1, 1, 1], 10); for (let k = 0; k < 4; k++) rod(f, 0.005, 0.07, m.porcelain, 0, 0.9, sz * 0.07, [k * 0.785, 0, HALF], 6); }
    rod(f, 0.012, 0.14, m.brass, 0, 0.84, 0, [HALF, 0, 0], 10);
    torus(f, 0.16, 0.012, m.brass, -0.16, 0.84, 0, [0, 0, 0], Math.PI, 16);
    rod(f, 0.009, 0.16, m.brass, 0, 0.94, 0, null, 8); for (const sz of [-1, 1]) torus(f, 0.022, 0.006, m.brass, 0, 1.0, sz * 0.04, [0, HALF, 0], Math.PI, 8);
    rod(f, 0.014, 0.17, m.porcelain, 0, 1.03, 0, [HALF, 0, 0], 10); sph(f, 0.026, m.brass, 0, 1.03, -0.09, [1, 0.7, 1], 10); sph(f, 0.02, m.brass, 0, 1.03, 0.085, [1, 1, 1], 10);
    const bt = grp(g, 0.12, 0.61, W / 2);
    for (const sx of [-1, 1]) rod(bt, 0.006, W + 0.04, m.brass, sx * 0.07, 0.006, 0, [HALF, 0, 0], 6);
    for (let k = -2; k <= 2; k++) rod(bt, 0.004, 0.14, m.brass, 0, 0.006, k * 0.07, [0, 0, HALF], 5);
    candle(bt, m, 0, 0.012, -0.14, 0.08); bookStack(bt, m, 1, 0.0, 0.012, 0.1, 41, 1.57); towelRoll(bt, m, 0, 0.012, 0.27, m.towel2, 0.14);
    g.userData.solidBox = { w: L, d: W, h: 0.6, z: W / 2 };
    bathPlay(g, m, L, [L / 2 - 0.12 - 0.32 * FILLER_DX, 0.838, 0.1 + 0.32 * FILLER_DZ], yT + 0.372, [0.42, 0.55, 0.44, L / 2 - 0.2, 0.6, 0.22], o.cut);
    return g;
  }
  if (m.styleId === 'kyoto') {
    // ofuro: a deep soaking tub of oiled oak staves with a stone surround step, wooden lid half-on, a hinoki stool
    const T = 0.05, Hh = 0.66, oak = m.woodLight;
    box(g, L, 0.08, W, m.stone, 0, 0, W / 2);
    box(g, L - 0.04, Hh - 0.08, T, oak, 0, 0.08, W - T / 2); box(g, L - 0.04, Hh - 0.08, T, oak, 0, 0.08, T / 2);
    for (const sx of [-1, 1]) box(g, T, Hh - 0.08, W - 0.02, oak, sx * (L / 2 - 0.02 - T / 2), 0.08, W / 2);
    for (const yy of [0.2, Hh - 0.12]) for (const sz of [0.005, W - 0.005]) box(g, L - 0.02, 0.025, 0.012, m.blackMetal, 0, yy, sz);   // bronze hoops
    box(g, L - 0.04 - 2 * T, 0.02, W - 2 * T - 0.02, m.woodDark, 0, 0.1, W / 2);
    box(g, L - 0.04 - 2 * T, 0.004, W - 2 * T - 0.02, m.water, 0, Hh - 0.12, W / 2);
    for (let i = 0; i < 4; i++) box(g, 0.2, 0.025, W - 0.02, oak, -L / 2 + 0.14 + i * 0.205, Hh, W / 2);                   // lid boards, half on
    lathe(g, [[0, 0], [0.09, 0], [0.11, 0.1], [0.105, 0.1], [0.085, 0.008], [0, 0.008]], oak, -L / 2 + 0.3, Hh + 0.025, W / 2, 20);   // wooden bucket on the lid
    towelRoll(g, m, -L / 2 + 0.55, Hh + 0.025, W / 2 + 0.1, m.towel, 0.3);
    // bronze wall spout over the open end of the tub
    const sx = L / 2 - 0.3;
    cyl(g, 0.032, 0.032, 0.012, m.blackMetal, sx, 0.9, 0.006, 16, [HALF, 0, 0]); rod(g, 0.014, 0.2, m.blackMetal, sx, 0.9, 0.1, [HALF, 0, 0]);
    cyl(g, 0.013, 0.013, 0.034, m.blackMetal, sx, 0.868, 0.19, 12); rod(g, 0.006, 0.07, m.blackMetal, sx + 0.07, 0.93, 0.02, [0, 0, 0.5], 8); cyl(g, 0.02, 0.02, 0.012, m.blackMetal, sx + 0.07, 0.9, 0.006, 12, [HALF, 0, 0]);
    g.userData.solidBox = { w: L, d: W, h: Hh, z: W / 2 };
    bathPlay(g, m, L, [sx, 0.868, 0.19], Hh - 0.115, [0.26, 0.24, 0.26, sx + 0.03, 0.78, 0.13], o.cut);
    return g;
  }
  if (s === 'milano') {
    // built-in tub clad in black marble
    box(g, L, 0.56, W, m.marble, 0, 0, W / 2);
    rbox(g, L - 0.14, 0.02, W - 0.14, 0.05, m.porcelain, 0, 0.545, W / 2);
    box(g, L - 0.18, 0.01, W - 0.18, m.water, 0, 0.52, W / 2);
    tap(g, m, L / 2 - 0.35, 0.56, 0.035, 0.2);                    // deck-mounted filler on the wall-side ledge
  } else {
    // freestanding oval tub
    const gg = grp(g, 0, 0, W / 2); gg.scale.set(L / W, 1, 1);
    lathe(gg, [[0, 0.04], [W * 0.32, 0.03], [W * 0.46, 0.2], [W * 0.5, 0.58], [W * 0.47, 0.6], [W * 0.43, 0.22], [W * 0.3, 0.1], [0.001, 0.1]], m.porcelain, 0, 0, 0, 40);
    disc(gg, W * 0.44, m.water, 0, 0.42, 0, [-HALF, 0, 0], 32);
    lathe(gg, [[0, 0], [W * 0.3, 0], [W * 0.32, 0.04], [0, 0.04]], m.porcelain, 0, 0, 0, 32);
    // floor-standing filler
    const f = grp(g, L / 2 - 0.12, 0, 0.08, FILLER_RY);
    rod(f, 0.018, 0.9, m.tap, 0, 0.45, 0);
    torus(f, 0.15, 0.016, m.tap, -0.15, 0.9, 0, [0, 0, 0], Math.PI, 16);
    cyl(f, 0.05, 0.05, 0.02, m.tap, 0, 0, 0, 16);
  }
  // bath tray with candle & book
  const bt = grp(g, 0.1, s === 'milano' ? 0.57 : 0.6, W / 2);
  box(bt, 0.12, 0.02, W + 0.02, s === 'nordic' ? m.woodLight : m.teak, 0, 0, 0);
  candle(bt, m, 0.0, 0.02, -0.15, 0.08);
  bookStack(bt, m, 1, 0.0, 0.02, 0.12, 41, 1.57);
  g.userData.solidBox = { w: L, d: W, h: 0.6, z: W / 2 };
  if (s === 'milano') bathPlay(g, m, L, [L / 2 - 0.35, 0.7, 0.195], 0.531, [0.18, 0.3, 0.3, L / 2 - 0.35, 0.6, 0.12], o.cut);
  else bathPlay(g, m, L, [L / 2 - 0.12 - 0.3 * FILLER_DX, 0.898, 0.08 + 0.3 * FILLER_DZ], 0.422, [0.4, 0.55, 0.42, L / 2 - 0.2, 0.6, 0.21], o.cut);
  return g;
}
function shower(m, o = {}) {            // walk-in shower: w (x) × d (z), back wall at z = 0, glass panel at +z
  const W = o.w || 1.2, D = o.d || 0.9, g = new THREE.Group(), s = m.fam, GH = o.h || 2.0;
  box(g, W, 0.012, D, m.floorBath, 0, 0, D / 2);
  box(g, W * 0.6, 0.004, 0.06, m.steel, 0, 0.012, D - 0.1);        // linear drain
  const gw = Math.min(W - 0.1, 1.0);
  const prof = s === 'nordic' ? m.blackMetal : s === 'milano' ? m.brass : m.brass;
  box(g, gw, GH, 0.01, m.glass, W / 2 - gw / 2, 0.02, D);
  box(g, 0.02, GH, 0.03, prof, W / 2 - 0.01, 0.02, D);               // wall profile
  box(g, gw, 0.022, 0.026, prof, W / 2 - gw / 2, 0.012, D);          // floor channel
  box(g, 0.006, GH - 0.02, 0.012, m.crystal, W / 2 - gw + 0.003, 0.03, D);   // polished free edge catches the light
  const t = m.tap, dyn = playGroup(g, 'shower-dyn'), mx = Math.min(0.3, W / 2 - 0.15);
  if (GH > 1.5) {
    rod(g, 0.008, D, s === 'nordic' ? m.blackMetal : m.brass, W / 2 - gw, 2.0, D / 2, [HALF, 0, 0]);
    // rain head
    rod(g, 0.01, 0.35, t, 0, 2.2, 0.175, [HALF, 0, 0]);
    cyl(g, 0.15, 0.15, 0.012, t, 0, 2.18, 0.35, 32);
    // tap the mixer or the head: rain falls in a cone from the head, splashes on the tray, a little steam rises
    const out = showerOutlet(dyn, m, 'shower', { x: 0, y: 2.176, z: 0.35, R: 0.3, H: 2.16 });
    out.proxy(0.26, 0.66, 0.12, mx + 0.03, 0.95, 0.06); out.proxy(0.36, 0.12, 0.52, 0, 2.12, 0.26);
    g.userData.shower = dyn.userData.shower = out;
  }
  // mixer + hand shower (right of the head), niche with the shampoo & shower-gel pumps (left)
  cyl(g, 0.035, 0.035, 0.02, t, mx, 1.1, 0.01, 16, [HALF, 0, 0]);
  rod(g, 0.008, 0.07, t, mx, 1.1, 0.05, [HALF, 0, 0]);
  rod(g, 0.009, 0.25, t, mx + 0.09, 1.4, 0.03);
  // (the niche sits above the glass panel's walking collider, so a tap through the glass reaches the pumps)
  const nx = -W / 2 + 0.3, ny = GH > 1.5 ? 1.136 : 0.72;
  box(g, 0.44, 0.3, 0.01, s === 'milano' ? m.brass : m.stone, nx, ny, 0.01);
  box(g, 0.44, 0.014, 0.125, s === 'milano' ? m.brass : m.stone, nx, ny, 0.0665);
  const soap = soapLedge(g, dyn, m, 'shower', nx - 0.07, ny + 0.014, 0.004, { ledge: false });
  lathe(g, [[0, 0], [0.028, 0], [0.028, 0.18], [0.01, 0.21], [0, 0.21]], m.ceramic2, nx + 0.14, ny + 0.014, 0.046, 12);
  g.userData.soap = dyn.userData.soap = soap;
  g.userData.solidBox = null;             // walkable into, panel is solid via its own box
  g.userData.glassPanel = { x: W / 2 - gw / 2, z: D, w: gw };
  return g;
}
function towelRail(m, o = {}) {
  const g = new THREE.Group(), W = 0.5, H = 1.2, t = m.fam === 'nordic' ? m.blackMetal : m.brass;
  for (const sx of [-1, 1]) rod(g, 0.012, H, t, sx * W / 2, 0.3 + H / 2, 0.06);
  for (let i = 0; i < 6; i++) rod(g, 0.008, W, t, 0, 0.35 + i * 0.2, 0.06, [0, 0, HALF]);
  // bath towel folded over the top bar (two hanging layers + the soft roll over the bar), hand towel lower down
  const tw = { e: [0.1, 0.08, 0.7], seg: 16 };
  soft(g, W - 0.07, 0.55, 0.022, m.towel, 0, 0.81, 0.084, null, tw);
  soft(g, W - 0.07, 0.5, 0.022, m.towel, 0, 0.86, 0.037, null, tw);
  soft(g, W - 0.07, 0.05, 0.07, m.towel, 0, 1.33, 0.06, null, { e: [0.1, 0.8, 0.8], seg: 16 });
  soft(g, W - 0.17, 0.4, 0.02, m.towel2, 0, 0.56, 0.108, null, tw);
  soft(g, W - 0.17, 0.045, 0.06, m.towel2, 0, 0.93, 0.085, null, { e: [0.1, 0.8, 0.8], seg: 16 });
  g.userData.noSolid = true;
  return g;
}

// ================================================================== DECOR / LIGHTING / PLANTS
// Kyoto bonsai / niwaki: a twisting trunk in a shallow dark pot, clipped "cloud" foliage pads on short branches,
// moss on the soil. h = overall height.
function bonsai(p, m, x, y, z, h = 0.35, seed = 3) {
  const g = grp(p, x, y, z), r = rngF(seed * 31 + 7), s = h / 0.35, potR = 0.13 * Math.min(s, 1.8), sp = Math.min(s, 2.4);
  lathe(g, [[0, 0], [potR * 0.9, 0], [potR, potR * 0.18], [potR * 1.04, potR * 0.38], [potR * 0.98, potR * 0.38], [0, potR * 0.34]], m.pot, 0, 0, 0, 24);
  const top = potR * 0.36;
  cyl(g, potR * 0.94, potR * 0.94, 0.004, m.foliage || m.leaf, 0, top - 0.004, 0, 20);
  let px = 0, py = top, pz = 0;
  const segs = 5, pads = [];
  for (let i = 0; i < segs; i++) {
    const a = r() * 6.28, lean = 0.35 + r() * 0.4, len = h * 0.16, dx = Math.cos(a) * Math.sin(lean) * len, dz = Math.sin(a) * Math.sin(lean) * len * 0.6, dy = Math.cos(lean) * len;
    const mx = px + dx / 2, my = py + dy / 2, mz = pz + dz / 2;
    const L = Math.hypot(dx, dy, dz), rr = 0.018 * s * (1 - i * 0.14);
    const o = rod(g, rr, L, m.stem, mx, my, mz, null, 6); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    px += dx; py += dy; pz += dz;
    if (i >= 1) {
      // a near-horizontal side branch, alternating sides, ending in a clipped cloud pad
      const ba = a + (i % 2 ? 2.4 : -2.4) + (r() - 0.5) * 0.6, bl = (0.05 + r() * 0.05) * sp * (1.3 - i * 0.12);
      const bv = new THREE.Vector3(Math.cos(ba) * bl, bl * 0.25, Math.sin(ba) * bl * 0.7);
      const bo = rod(g, rr * 0.55, bv.length(), m.stem, px + bv.x / 2, py + bv.y / 2, pz + bv.z / 2, null, 5);
      bo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bv.clone().normalize());
      pads.push([px + bv.x, py + bv.y, pz + bv.z, (0.065 + r() * 0.04) * sp * (1.15 - i * 0.08)]);
    }
  }
  pads.push([px, py + 0.02 * s, pz, 0.11 * sp]);
  for (const [qx, qy, qz, R] of pads) {
    soft(g, R * 2.1, R * 0.75, R * 1.6, m.foliage || m.leaf, qx, qy - R * 0.2, qz, [0, r() * 3, 0], { e: [0.5, 0.6, 0.5], seg: 16 });
    soft(g, R * 1.3, R * 0.6, R * 1.1, m.foliage || m.leaf, qx + R * 0.4, qy + R * 0.25, qz - R * 0.2, [0, r() * 3, 0], { e: [0.55, 0.6, 0.55], seg: 12 });
  }
  return g;
}
// Ikebana: a slim dark vase holding one sweeping branch with blossoms and a couple of leaves (kyoto's vase stems)
function ikebana(p, m, x, y, z, h, seed = 1) {
  const r = rngF(seed * 17 + 3), n = 3;
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, lean = 0.25 + r() * 0.5, len = (0.28 + r() * 0.3) * (i ? 0.7 : 1);
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
    const o = rod(p, 0.004, len, m.stem, x + dir.x * len / 2, y + h + dir.y * len / 2 - 0.02, z + dir.z * len / 2, null, 4);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    for (let k = 0; k < 5; k++) { const t = 0.45 + k * 0.13; sph(p, 0.013 + r() * 0.006, m.flower, x + dir.x * len * t + (r() - 0.5) * 0.03, y + h - 0.02 + dir.y * len * t, z + dir.z * len * t + (r() - 0.5) * 0.03, [1, 0.8, 1], 6); }
    if (i === 0) leaf(p, m, 'lance', 0.12, 0.05, x, y + h, z, -0.6, a + 1.2, 0.3, m.leaf2);
  }
}
function plantSmall(p, m, x, y, z, h = 0.25, ry = 0) {
  if (m.styleId === 'kyoto') return bonsai(p, m, x, y, z, Math.max(0.2, h), ((x * 13 + z * 7) | 0) + 5);
  const g = grp(p, x, y, z, ry);
  lathe(g, [[0, 0], [0.05, 0], [0.065, h * 0.4], [0.06, h * 0.42], [0, h * 0.42]], m.pot, 0, 0, 0, 16);
  const r = rngF(((x + z) * 1000) | 0 + 11);
  for (let i = 0; i < 9; i++) { const a = i * 0.7 + r(); leaf(g, m, 'heart', h * 0.35, h * 0.3, Math.cos(a) * 0.03, h * 0.4, Math.sin(a) * 0.03, -0.6 - r() * 0.8, a, 0, i % 2 ? m.leaf : m.leaf2); }
  return g;
}
function plant(m, o = {}) {
  if (m.styleId === 'kyoto' && !o.kind) {
    // a cloud-pruned niwaki in a wide, low charcoal stoneware bowl on an oak stand
    const g = new THREE.Group(), H = o.h || 1.6;
    box(g, 0.56, 0.12, 0.56, m.woodLight, 0, 0, 0);
    const b = bonsai(g, m, 0, 0.12, 0, Math.min(1.5, H * 0.85), o.seed || 5); void b;
    g.userData.solidBox = { w: 0.6, d: 0.6, h: 1 };
    g.userData.ao = { w: 0.9, d: 0.9, cell: 'disc' };
    return g;
  }
  const kind = o.kind || ({ milano: 'fig', nordic: 'monstera', riviera: 'olive' }[m.fam]);
  const H = o.h || 1.6, g = new THREE.Group(), r = rngF(o.seed || 5);
  // pot
  const pr = kind === 'snake' ? 0.14 : 0.2;
  if (m.fam === 'riviera') lathe(g, [[0, 0], [pr * 0.8, 0], [pr, pr * 1.8], [pr * 1.05, pr * 1.9], [pr * 0.95, pr * 1.9], [0, pr * 1.75]], m.pot, 0, 0, 0, 24);
  else if (m.fam === 'milano') { cyl(g, pr, pr * 0.95, pr * 2.1, m.pot, 0, 0, 0, 24); }
  else lathe(g, [[0, 0], [pr * 0.9, 0], [pr * 1.05, pr * 0.9], [pr * 0.9, pr * 1.8], [0, pr * 1.8]], m.pot, 0, 0, 0, 24);
  const top = kind === 'snake' ? pr * 1.8 : pr * (m.fam === 'milano' ? 2.1 : 1.8);
  cyl(g, pr * 0.9, pr * 0.9, 0.01, m.soil, 0, top - 0.03, 0, 16);
  if (kind === 'fig') {
    // fiddle-leaf fig: slim trunk, three branches, leaves in overlapping clusters, larger towards the top
    rod(g, 0.02, H * 0.62, m.stem, 0, top + H * 0.3, 0, [0.04, 0, 0.03], 6);
    const br = [[0, 0.62, 0, 0.3], [1.9, 0.5, 0.2, 0.26], [4.1, 0.42, 0.24, 0.22], [3.0, 0.34, 0.26, 0.2]];
    for (const [a0, hy, lean, rad] of br) {
      const bx = Math.cos(a0) * lean * 0.5, bz = Math.sin(a0) * lean * 0.5, by = top + H * hy;
      if (lean) rod(g, 0.01, 0.3, m.stem, bx * 0.5, by - 0.08, bz * 0.5, [Math.sin(a0) * 0.7, 0, -Math.cos(a0) * 0.7], 5);
      const n = 15;
      for (let i = 0; i < n; i++) {
        const t = i / n, a = a0 + i * 2.39, rr = rad * (0.35 + 0.65 * Math.sqrt(t)), yy = by + (1 - t) * H * 0.3 - 0.05;
        const size = 0.2 + (1 - t) * 0.08 + r() * 0.05;
        leaf(g, m, 'fiddle', size * 1.25, size, bx + Math.cos(a) * rr, yy, bz + Math.sin(a) * rr, -0.15 - t * 0.9 - r() * 0.3, -a + HALF, (r() - 0.5) * 0.5, i % 3 ? m.leaf : m.leaf2);
      }
    }
  } else if (kind === 'monstera') {
    for (let i = 0; i < 17; i++) {
      const a = i * 2.2 + r() * 0.4, tl = 0.35 + r() * (H * 0.42), lean = 0.3 + r() * 0.45;
      const ex = Math.sin(lean) * tl * Math.cos(a), ez = Math.sin(lean) * tl * Math.sin(a), ey = Math.cos(lean) * tl;
      rod(g, 0.007, tl, m.stem, ex / 2, top + ey / 2, ez / 2, [Math.sin(a) * lean, 0, -Math.cos(a) * lean], 5);
      const sz = 0.34 + r() * 0.16;
      leaf(g, m, i % 3 ? 'monstera' : 'heart', sz * 1.05, sz, ex, top + ey - 0.04, ez, -0.75 - r() * 0.5, -a + HALF, (r() - 0.5) * 0.3, i % 2 ? m.leaf : m.leaf2);
    }
  } else if (kind === 'olive') {
    rod(g, 0.022, H * 0.55, m.stem, 0, top + H * 0.27, 0, [0.08, 0, -0.05], 6);
    for (let b = 0; b < 5; b++) {
      const a = b * 1.26, cx = Math.cos(a) * 0.18, cz = Math.sin(a) * 0.18, cy = top + H * (0.6 + r() * 0.3);
      rod(g, 0.01, 0.3, m.stem, cx / 2, cy - 0.12, cz / 2, [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], 5);
      for (let i = 0; i < 26; i++) { const u = r() * 6.28, v = r() * 3.14, rr = 0.2 * r() + 0.06; leaf(g, m, 'lance', 0.08, 0.025, cx + Math.cos(u) * Math.sin(v) * rr, cy + Math.cos(v) * rr * 0.7, cz + Math.sin(u) * Math.sin(v) * rr, r() * 3, r() * 6, r() * 3, i % 2 ? m.leaf : m.leaf2); }
    }
  } else if (kind === 'snake') {
    for (let i = 0; i < 12; i++) { const a = i * 2.4, rr = 0.04 + r() * 0.06; leaf(g, m, 'blade', H * (0.45 + r() * 0.4), 0.07, Math.cos(a) * rr, top - 0.02, Math.sin(a) * rr, (r() - 0.5) * 0.3, a, (r() - 0.5) * 0.3, i % 2 ? m.leaf : m.leaf2); }
  } else { // palm / grass
    for (let i = 0; i < 16; i++) { const a = i * 2.4; leaf(g, m, 'blade', H * (0.5 + r() * 0.4), 0.05, 0, top - 0.02, 0, 0.3 + r() * 0.5, a, 0, i % 2 ? m.leaf : m.leaf2); }
  }
  g.userData.solidBox = { w: pr * 2.2, d: pr * 2.2, h: 1 };
  g.userData.ao = { w: pr * 3.4, d: pr * 3.4, cell: 'disc' };
  return g;
}
function floorLamp(m, o = {}) {
  const s = m.fam, g = new THREE.Group();
  if (m.styleId === 'kyoto') {
    // Akari-style column: a tall washi cylinder with bamboo ribs on slender bronze legs
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; rod(g, 0.006, 0.32, m.blackMetal, Math.cos(a) * 0.11, 0.16, Math.sin(a) * 0.11, [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12], 6); }
    const R = 0.17, H = 1.05, y0 = 0.3;
    const sh = cyl(g, R, R, H, m.washi, 0, y0, 0, 32, null, true); void sh;
    for (const yy of [y0, y0 + H]) torus(g, R, 0.005, m.blackMetal, 0, yy, 0, [HALF, 0, 0], Math.PI * 2, 32);
    for (let k = 0; k < 3; k++) sph(g, 0.035, m.bulb, 0, y0 + 0.25 + k * 0.3, 0, [1, 1, 1], 8);
    bloom(g, 0, y0 + H * 0.55, 0, 1.3, 0.6);
    fxFlat(g, m.glowFaint, 'disc', 0, 0.014, 0, 1.3, 1.3);
    fxFlat(g, m.glowFaint, 'disc', 0, (o.ceil || 2.7) - 0.004, 0, 1.4, 1.4, true);
    g.userData.solidBox = { w: 0.38, d: 0.38, h: 1.4 };
    return g;
  }
  if (m.styleId === 'paris') {
    // brass stem on a Carrara disc carrying three opal globes at staggered heights
    cyl(g, 0.16, 0.17, 0.03, m.marble, 0, 0, 0, 32); cyl(g, 0.03, 0.04, 0.03, m.brass, 0, 0.03, 0, 16);
    rod(g, 0.011, 1.56, m.brass, 0, 0.81, 0, null, 10); sph(g, 0.02, m.brass, 0, 1.6, 0, [1, 1, 1], 10);
    for (const [a, y, r, len] of [[0.4, 1.5, 0.11, 0.2], [2.5, 1.27, 0.09, 0.17], [4.6, 1.06, 0.075, 0.15]]) {
      const x = Math.cos(a) * len, z = Math.sin(a) * len;
      rod(g, 0.006, len, m.brass, x / 2, y - r - 0.02, z / 2, [0, -a, HALF], 6); rod(g, 0.006, 0.03, m.brass, x, y - r - 0.006, z, null, 6);
      cyl(g, 0.03, 0.022, 0.02, m.brass, x, y - r - 0.004, z, 12); sph(g, r, m.opal, x, y, z, [1, 1, 1], 20); bloom(g, x, y, z, r * 5.5, 0.5);
    }
    fxFlat(g, m.glowFaint, 'disc', 0, (o.ceil || 2.7) - 0.004, 0, 1.6, 1.6, true);
    fxFlat(g, m.glowFaint, 'disc', 0, 0.014, 0, 1.3, 1.3);
    g.userData.solidBox = { w: 0.36, d: 0.36, h: 1.5 };
    return g;
  }
  if (s === 'milano') {
    // arc lamp, marble base, brass arc, dome
    box(g, 0.3, 0.14, 0.3, m.marble, 0, 0, 0);
    const arcR = 0.95;
    torus(g, arcR, 0.012, m.brass, arcR, 1.3, 0, [0, 0, 0], Math.PI * 0.62, 32).rotation.z = Math.PI * 0.38;
    rod(g, 0.012, 1.2, m.brass, 0, 0.74, 0);
    const d = grp(g, 1.55, 1.95, 0);
    lathe(d, [[0.001, 0.18], [0.1, 0.16], [0.2, 0.06], [0.22, 0], [0.215, 0], [0.19, 0.055], [0.001, 0.15]], m.brass, 0, 0, 0, 28);
    sph(d, 0.05, m.bulb, 0, 0.04, 0, [1, 1, 1], 10);
    fxFlat(g, m.glow, 'disc', 1.55, 0.014, 0, 1.3, 1.3);
    bloom(d, 0, -0.02, 0, 0.6, 0.6);
    g.userData.solidBox = { w: 0.32, d: 0.32, h: 1.5 };
  } else if (s === 'nordic') {
    for (let i = 0; i < 3; i++) { const a = i * 2.094; rod(g, 0.012, 1.3, m.woodLight, Math.cos(a) * 0.14, 0.62, Math.sin(a) * 0.14, [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2], 8); }
    cyl(g, 0.2, 0.24, 0.34, m.lampShade, 0, 1.25, 0, 28, null, true);
    sph(g, 0.04, m.bulb, 0, 1.38, 0, [1, 1, 1], 8);
    bloom(g, 0, 1.42, 0, 1.0, 0.55);
    fxFlat(g, m.glowFaint, 'disc', 0, (o.ceil || 2.7) - 0.004, 0, 1.8, 1.8, true);
    fxFlat(g, m.glowFaint, 'disc', 0, 0.014, 0, 1.1, 1.1);
    g.userData.solidBox = { w: 0.4, d: 0.4, h: 1.5 };
  } else {
    cyl(g, 0.14, 0.16, 0.03, m.woodDark, 0, 0, 0, 20);
    rod(g, 0.012, 1.35, m.woodDark, 0, 0.68, 0);
    sph(g, 0.24, m.rattanShade, 0, 1.55, 0, [1, 0.85, 1], 24);
    sph(g, 0.19, m.lampShade, 0, 1.55, 0, [1, 0.85, 1], 14);
    bloom(g, 0, 1.55, 0, 1.1, 0.5);
    fxFlat(g, m.glowFaint, 'disc', 0, (o.ceil || 2.7) - 0.004, 0, 1.6, 1.6, true);
    fxFlat(g, m.glowFaint, 'disc', 0, 0.014, 0, 1.4, 1.4);
    g.userData.solidBox = { w: 0.34, d: 0.34, h: 1.5 };
  }
  return g;
}
// Pendant hanging from the ceiling: origin at CEILING point (y=0), hangs down by `drop`.
// Monaco: tiered Art-Deco chandelier — brass hoops hung with cut-crystal drops and prisms, candle-bulbs on the top ring
function chandelier(m, o = {}) {
  const g = new THREE.Group(), kind = o.kind || 'dining', big = kind === 'dining';
  const drop = big ? Math.min(o.drop || 0.85, 0.75) : 0.42, R = big ? 0.42 : 0.3, H = big ? 0.6 : 0.42, B = m.brass, C = m.crystalLit || m.crystal;
  cyl(g, 0.09, 0.09, 0.025, B, 0, -0.025, 0, 24);                               // canopy
  for (let i = 0; i < 3; i++) rod(g, 0.0035, drop - 0.05, B, Math.cos(i * 2.094) * 0.05, -(drop - 0.05) / 2 - 0.02, Math.sin(i * 2.094) * 0.05, null, 5);
  const y0 = -drop;                                                              // top of the body
  rod(g, 0.012, H, B, 0, y0 - H / 2, 0, null, 10);                              // spine
  lathe(g, [[0.001, 0], [0.05, -0.01], [0.03, -0.05], [0.001, -0.06]], B, 0, y0 - H, 0, 16);   // finial
  const tiers = big ? [[R, 0], [R * 0.72, H * 0.42], [R * 0.42, H * 0.78]] : [[R, 0], [R * 0.6, H * 0.55]];
  tiers.forEach(([r, dy], ti) => {
    const y = y0 - dy;
    torus(g, r, 0.008, B, 0, y, 0, [HALF, 0, 0], Math.PI * 2, 40);
    for (let k = 0; k < 4; k++) { const a = k * HALF + ti * 0.4; rod(g, 0.004, r, B, Math.cos(a) * r / 2, y, Math.sin(a) * r / 2, [0, -a, HALF], 5); }
    const n = Math.round(r * 2 * Math.PI / 0.042);
    for (let k = 0; k < n; k++) {                                                // strands of drops: bead, bead, prism
      const a = k / n * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, len = (k % 2 ? 0.13 : 0.2) * (ti ? 0.8 : 1) * (big ? 1 : 0.8);
      for (let b = 0; b < 3; b++) sph(g, 0.0075, C, x, y - 0.016 - b * 0.017, z, [1, 1, 1], 6);
      lathe(g, [[0.001, 0], [0.0105, -len * 0.22], [0.001, -len * 0.5]], C, x, y - 0.062, z, 6);
      if (k % 3 === 0) sph(g, 0.0055, C, x, y - 0.066 - len * 0.52, z, [1, 1, 1], 6);
    }
    if (ti === 0) {                                                              // candle bulbs on the widest hoop
      const nb = big ? 8 : 6;
      for (let k = 0; k < nb; k++) {
        const a = k / nb * Math.PI * 2 + 0.2, x = Math.cos(a) * r * 0.86, z = Math.sin(a) * r * 0.86;
        cyl(g, 0.018, 0.022, 0.05, B, x, y, z, 12); cyl(g, 0.012, 0.012, 0.06, m.candle, x, y + 0.05, z, 10);
        sph(g, 0.016, m.bulb, x, y + 0.125, z, [1, 1.5, 1], 8);
      }
    }
  });
  bloom(g, 0, y0 - H * 0.2, 0, big ? 1.8 : 1.2, 0.75);
  fxFlat(g, m.glow, 'disc', 0, -0.004, 0, big ? 2.6 : 1.8, big ? 2.6 : 1.8, true);            // the ceiling wash
  g.userData.noSolid = true;
  return g;
}
// Kyoto: Akari-style washi lanterns — dining: three globes of different sizes hung at staggered heights; bedroom: one
function washiLantern(p, m, x, y, z, R, Hk = 1) {
  const g = grp(p, x, y, z);
  sph(g, R, m.washi, 0, -R * Hk, 0, [1, Hk, 1], 28);
  for (const s of [-1, 1]) cyl(g, R * 0.24, R * 0.24, 0.012, m.blackMetal, 0, s < 0 ? -0.006 : -2 * R * Hk - 0.006, 0, 14);
  sph(g, R * 0.25, m.bulb, 0, -R * Hk, 0, [1, 1, 1], 8);
  bloom(g, 0, -R * Hk, 0, R * 4.2, 0.55);
  return g;
}
function lanternPendant(m, o = {}) {
  const g = new THREE.Group(), kind = o.kind || 'dining';
  const set = kind === 'dining' ? [[-0.32, 0.92, 0.17, 1.05], [0.04, 0.7, 0.23, 0.95], [0.36, 1.0, 0.145, 1.15]] : [[0, 0.5, 0.23, 0.9]];
  for (const [x, drop, R, Hk] of set) {
    cyl(g, 0.04, 0.04, 0.015, m.blackMetal, x, -0.015, 0, 12);
    rod(g, 0.0025, drop, m.darkPlastic, x, -drop / 2, 0, null, 4);
    washiLantern(g, m, x, -drop, 0, R, Hk);
  }
  fxFlat(g, m.glowFaint, 'disc', 0, -0.004, 0, kind === 'dining' ? 2.2 : 1.5, kind === 'dining' ? 1.6 : 1.5, true);
  g.userData.noSolid = true;
  return g;
}
// Paris: plaster ceiling rose + a "molecule" chandelier — antique-brass arms radiating from a hub at three tiers,
// each ending in a glass globe (opal lit globes with a few smoked-glass ones in between) with a cut-crystal drop
// below it, and a collar of crystal strands around the hub
const _vy = new THREE.Vector3(0, 1, 0), _vd = new THREE.Vector3();
function globeChandelier(m, o = {}) {
  const g = new THREE.Group(), big = (o.kind || 'dining') === 'dining', B = m.brass, C = m.crystalLit || m.opal, Rr = big ? 0.36 : 0.27;
  cyl(g, Rr, Rr, 0.01, m.moulding, 0, -0.01, 0, 48); torus(g, Rr * 0.9, 0.016, m.moulding, 0, -0.012, 0, [HALF, 0, 0], Math.PI * 2, 48);
  torus(g, Rr * 0.46, 0.013, m.moulding, 0, -0.014, 0, [HALF, 0, 0], Math.PI * 2, 36); cyl(g, Rr * 0.3, Rr * 0.34, 0.02, m.moulding, 0, -0.03, 0, 32);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; sph(g, 0.03, m.moulding, Math.cos(a) * Rr * 0.68, -0.01, Math.sin(a) * Rr * 0.68, [0.55, 0.3, 1.5], 8, [0, -a + HALF, 0]); }
  cyl(g, 0.065, 0.05, 0.035, B, 0, -0.065, 0, 24);
  const drop = big ? Math.min(o.drop || 0.85, 0.62) : 0.36, y0 = -0.06 - drop;
  rod(g, 0.007, drop, B, 0, -0.06 - drop / 2, 0, null, 8);
  sph(g, big ? 0.05 : 0.04, B, 0, y0, 0, [1, 1, 1], 16);
  const arms = big ? 10 : 6, T = big ? [[0.44, -0.02, 0.085], [0.29, 0.15, 0.07], [0.24, -0.2, 0.062], [0.36, 0.06, 0.075], [0.16, -0.33, 0.055]] : [[0.27, -0.01, 0.068], [0.18, 0.11, 0.056], [0.15, -0.16, 0.05]];
  for (let i = 0; i < arms; i++) {
    const [len, dy, r] = T[i % T.length], a = i * 2.39996 + 0.3, x = Math.cos(a) * len, z = Math.sin(a) * len, y = y0 + dy, d = Math.hypot(len, dy);
    const arm = rod(g, 0.0055, d, B, x / 2, y0 + dy / 2, z / 2, null, 6); arm.quaternion.setFromUnitVectors(_vy, _vd.set(x, dy, z).normalize());
    const k = (r + 0.012) / d; cyl(g, 0.02, 0.014, 0.022, B, x * (1 - k), y - dy * k - 0.011, z * (1 - k), 10);
    const lit = i % 4 !== 3;
    sph(g, r, lit ? m.opal : m.smoked, x, y, z, [1, 1, 1], 20);
    if (lit) bloom(g, x, y, z, r * 5, 0.5); else sph(g, 0.012, m.bulb, x, y, z, [1, 1.4, 1], 8);
    // a cut-crystal pampille under every globe: brass cap, two beads, a faceted drop
    const yc = y - r; cyl(g, 0.009, 0.006, 0.012, B, x, yc - 0.012, z, 8);
    for (let b = 0; b < 2; b++) sph(g, 0.009, C, x, yc - 0.024 - b * 0.02, z, [1, 1, 1], 6);
    lathe(g, [[0.001, 0], [0.017, -0.03], [0.001, -0.085]], C, x, yc - 0.052, z, 6);
  }
  // a crystal collar around the hub: a brass hoop hung with short strands
  const cr = big ? 0.13 : 0.1, nc = big ? 14 : 10;
  torus(g, cr, 0.005, B, 0, y0 - 0.02, 0, [HALF, 0, 0], Math.PI * 2, 28);
  for (let k = 0; k < 3; k++) { const a = k * 2.094; rod(g, 0.003, cr, B, Math.cos(a) * cr / 2, y0 - 0.02, Math.sin(a) * cr / 2, [0, -a, HALF], 5); }
  for (let k = 0; k < nc; k++) {
    const a = k / nc * Math.PI * 2, x = Math.cos(a) * cr, z = Math.sin(a) * cr, len = k % 2 ? 0.07 : 0.11;
    for (let b = 0; b < 2; b++) sph(g, 0.007, C, x, y0 - 0.034 - b * 0.016, z, [1, 1, 1], 6);
    lathe(g, [[0.001, 0], [0.012, -len * 0.3], [0.001, -len]], C, x, y0 - 0.06, z, 6);
  }
  lathe(g, [[0.001, 0], [0.026, -0.04], [0.001, -0.13]], C, 0, y0 - (big ? 0.05 : 0.04), 0, 8);   // centre drop under the hub
  bloom(g, 0, y0, 0, big ? 1.5 : 1.0, 0.4);
  fxFlat(g, m.glow, 'disc', 0, -0.004, 0, big ? 2.6 : 1.9, big ? 2.6 : 1.9, true);
  g.userData.noSolid = true;
  return g;
}
function pendant(m, o = {}) {
  if (m.styleId === 'monaco') return chandelier(m, o);
  if (m.styleId === 'paris') return globeChandelier(m, o);
  if (m.styleId === 'kyoto') return lanternPendant(m, o);
  const s = m.fam, g = new THREE.Group(), drop = o.drop || 0.9, kind = o.kind || 'dining';
  cyl(g, 0.06, 0.06, 0.02, s === 'nordic' ? m.blackMetal : m.metal, 0, -0.02, 0, 16);
  if (s === 'milano') {
    if (kind === 'dining') {
      // linear brass bar with opal globes
      const L = o.len || 1.2;
      for (const sx of [-1, 1]) rod(g, 0.002, drop - 0.1, m.brass, sx * L * 0.4, -(drop - 0.1) / 2, 0, null, 4);
      box(g, L, 0.025, 0.04, m.brass, 0, -drop, 0);
      for (let i = 0; i < 5; i++) { sph(g, 0.07, m.opal, -L * 0.4 + i * L * 0.2, -drop - 0.07, 0, [1, 1, 1], 16); bloom(g, -L * 0.4 + i * L * 0.2, -drop - 0.07, 0, 0.42, 0.55); }
    } else {
      rod(g, 0.003, drop, m.brass, 0, -drop / 2, 0, null, 4);
      lathe(g, [[0.001, 0.02], [0.14, 0], [0.2, -0.12], [0.195, -0.12], [0.13, -0.01], [0.001, 0.01]], m.brass, 0, -drop, 0, 28);
      sph(g, 0.05, m.bulb, 0, -drop - 0.05, 0, [1, 1, 1], 10);
      bloom(g, 0, -drop - 0.1, 0, 0.7, 0.6);
    }
  } else if (s === 'nordic') {
    rod(g, 0.003, drop, m.blackMetal, 0, -drop / 2, 0, null, 4);
    lathe(g, [[0.02, 0.04], [0.05, 0.03], [0.21, -0.14], [0.26, -0.2], [0.255, -0.2], [0.2, -0.15], [0.04, 0.02], [0.001, 0.02]], m.blackMetal, 0, -drop, 0, 32);
    disc(g, 0.25, m.lightEmit, 0, -drop - 0.18, 0, [HALF, 0, 0], 32);
    bloom(g, 0, -drop - 0.24, 0, 0.9, 0.5);
  } else {
    rod(g, 0.004, drop, m.woodDark, 0, -drop / 2, 0, null, 4);
    const R = kind === 'dining' ? 0.3 : 0.24;
    sph(g, R, m.rattanShade, 0, -drop - R * 0.7, 0, [1, 0.75, 1], 28);
    sph(g, R * 0.8, m.lampShade, 0, -drop - R * 0.7, 0, [1, 0.72, 1], 16);
    bloom(g, 0, -drop - R * 0.7, 0, R * 3.6, 0.45);
    fxFlat(g, m.glowFaint, 'disc', 0, -0.004, 0, 1.4, 1.4, true);
  }
  if (s === 'milano' && kind === 'dining') fxFlat(g, m.glowFaint, 'rect', 0, -0.004, 0, (o.len || 1.2) + 0.9, 0.9, true);
  g.userData.noSolid = true;
  return g;
}
// Rug: w × d, thickness 0.012
function rug(m, o = {}) {
  const g = new THREE.Group(), w = o.w || 2.4, d = o.d || 1.7;
  const r = box(g, w, 0.01, d, m.rug, 0, 0.001, 0);
  g.userData.noSolid = true;
  return g;
}
function artFrame(m, o = {}) {          // on a wall, back at z=0
  const w = o.w || 0.8, h = o.h || 1.0, i = (o.i || 0) % 3, g = new THREE.Group();
  const fm = m.artFrame, t = 0.03;
  box(g, w, h, 0.035, fm, 0, -h / 2, 0.0175);
  box(g, w - 0.04, h - 0.04, 0.004, m.porcelain, 0, -h / 2 + 0.02, 0.036);
  box(g, w - 0.14, h - 0.14, 0.004, m.art[i], 0, -h / 2 + 0.07, 0.039);
  g.userData.noSolid = true;
  return g;
}
// Curtains on a ceiling track: width w along x, height h (hanging down from y=0). Sheer centre + drapes at both sides.
// Pleated drape: pinch-pleat header (tight, regular) relaxing into deeper, slightly irregular folds that flare
// towards the hem. Plane in XY, hanging down from y = +h/2.
function curtainGeo(w, h, folds, depth, seed = 1) {
  return cg(`cur${r3(w)}|${r3(h)}|${folds}|${r3(depth)}|${seed}`, () => {
    const seg = Math.max(12, folds * 10), g = new THREE.PlaneGeometry(w, h, seg, 14);
    const p = g.attributes.position, r = rngF(seed * 7 + folds), amp = [], ph = [];
    for (let i = 0; i <= folds; i++) { amp.push(0.75 + r() * 0.5); ph.push((r() - 0.5) * 0.5); }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), k = (x / w + 0.5) * folds, fi = Math.max(0, Math.min(folds, Math.floor(k))), f = k - fi;
      const drop = 0.5 - y / h;                                   // 0 at the header → 1 at the hem
      const a = amp[fi] * (0.55 + 0.6 * drop), phase = f + ph[fi] * drop;
      let z = Math.sin(phase * Math.PI * 2) * depth * a;
      z += Math.sin(phase * Math.PI * 4) * depth * 0.18 * drop;       // secondary ripple
      p.setXYZ(i, x + Math.sin(phase * Math.PI * 2) * depth * 0.25 * drop, y, z);
    }
    g.computeVertexNormals(); return g;
  });
}
function curtains(m, o = {}) {
  // drawn open: at each end a sheer stack and a heavier drape in front of it; track spans the full width
  const w = o.w || 2.4, h = o.h || 2.6, g = new THREE.Group(), side = o.drape ?? 0.42, sheer = Math.min(0.7, w * 0.16);
  box(g, w + 0.1, 0.03, 0.1, m.fam === 'milano' ? m.brass : m.frame, 0, -0.03, 0);
  for (const sx of [-1, 1]) {
    add(g, curtainGeo(sheer, h - 0.05, Math.max(5, Math.round(sheer / 0.075)), 0.034, 2 + sx), m.sheer, sx * (w / 2 - sheer / 2 - 0.02), -h / 2 - 0.02, -0.02);
    add(g, curtainGeo(side, h - 0.05, Math.max(4, Math.round(side / 0.1)), 0.058, 5 + sx), m.curtain, sx * (w / 2 - side / 2 + 0.02), -h / 2 - 0.02, 0.05);
  }
  g.userData.noSolid = true;
  return g;
}
// ---- motorised curtains (movers of type 'scale' in one group: see apartment.js buildMovers)
// Closed state is authored: each layer is a pair of panels meeting in the middle. Opening scales a panel towards its
// outer end (the folds bunch up and deepen into a stack), a roller blind scales up into its cassette.
// Local frame: track at y = 0, cloth hanging to -h, x across the window, front (+z) into the room, window at -z.
function drapeGeo(w, h, folds, depth, seed = 1) {
  return cg(`drape${r3(w)}|${r3(h)}|${folds}|${r3(depth)}|${seed}`, () => {
    const g = new THREE.PlaneGeometry(w, h, Math.max(6, folds * 6), 8), p = g.attributes.position, r = rngF(seed * 13 + folds);
    const amp = [], ph = []; for (let i = 0; i <= folds; i++) { amp.push(0.8 + r() * 0.4); ph.push((r() - 0.5) * 0.4); }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), k = (x / w + 0.5) * folds, fi = Math.max(0, Math.min(folds, Math.floor(k))), f = k - fi;
      const drop = 0.5 - y / h, ph2 = f + ph[fi] * drop;
      p.setXYZ(i, x, y - h / 2, Math.sin(ph2 * Math.PI * 2) * depth * amp[fi] * (0.75 + 0.35 * drop));
    }
    g.computeVertexNormals(); return g;
  });
}
function motorCurtains(m, o = {}) {
  const w = o.w || 2.4, h = o.h || 2.5, s = m.fam, g = new THREE.Group(), id = o.id || 'cur';
  const blind = s === 'nordic';                          // nordic: blackout roller blind + sheer drapes
  // ceiling track (motor head at one end)
  const trackM = s === 'milano' || m.styleId === 'paris' ? m.brass : m.frame;
  box(g, w + 0.08, 0.028, 0.11, trackM, 0, -0.028, 0.005);
  box(g, 0.09, 0.05, 0.08, trackM, w / 2 - 0.02, -0.07, 0.01);
  const layer = (mat, z, depth, stack, seed, dOpen, dClose, part) => {
    for (const sx of [-1, 1]) {
      const pw = w / 2 + 0.03, folds = Math.max(5, Math.round(pw / 0.11));
      const mv = mover(g, sx * w / 2, -0.03, z, { type: 'scale', s: [Math.min(1, stack / pw), 1, 2.1], dur: 1900 + pw * 520, group: id, curtain: true, part, dOpen, dClose, tag: 'curtain' });
      add(mv, drapeGeo(pw, h - 0.06, folds, depth, seed + sx), mat, -sx * pw / 2, 0, 0);
      // weighted hem: a slim bar along the bottom of the blackout layer
      if (mat === m.blackout) box(mv, pw - 0.02, 0.012, 0.012, mat, -sx * pw / 2, -h + 0.05, 0);
    }
  };
  const sheerStack = Math.min(0.32, 0.12 + w * 0.04), drapeStack = Math.min(0.42, 0.16 + w * 0.05);
  if (blind) {
    layer(m.sheer, 0.03, 0.032, sheerStack, 3, 650, 0, 'curtain');
    // roller blind closest to the glass: cassette (static), fabric (scale up), bottom bar (slides up)
    const bz = -0.1, bh = h - 0.02;
    box(g, w + 0.02, 0.085, 0.085, m.frame, 0, -0.09, bz);
    const fb = mover(g, 0, -0.09, bz, { type: 'scale', s: [1, 0.02, 1], dur: 2600, group: id, curtain: true, part: 'curtain', dOpen: 0, dClose: 500, tag: 'blind' });
    box(fb, w - 0.01, bh - 0.09, 0.003, m.blackout, 0, -(bh - 0.09), 0);
    const bar = mover(g, 0, -bh, bz, { type: 'slide', dir: [0, 1, 0], dist: bh - 0.11, dur: 2600, group: id, curtain: true, proxy: false, dOpen: 0, dClose: 500 });
    box(bar, w - 0.008, 0.026, 0.018, m.frame, 0, 0, 0);
  } else {
    layer(m.sheer, -0.035, 0.034, sheerStack, 3, 700, 0, 'curtain');
    layer(m.blackout, 0.045, 0.052, drapeStack, 6, 0, 700, 'curtain');
  }
  g.userData.noSolid = true; g.userData.curtainId = id;
  return g;
}
// Wall switch for the motorised curtains, back at z = 0 (on the wall), centre at y = 0. The rocker / touch key tilts and
// the status LED slides between the "closed" (bottom) and "open" (top) marks — both are movers of the curtain group.
function curtainSwitch(m, o = {}) {
  const s = m.fam, g = new THREE.Group(), id = o.id || 'cur', S = 0.086;
  const plateM = s === 'milano' ? m.brass : s === 'nordic' ? m.plastic : m.ceramic;
  box(g, S, S, 0.009, plateM, 0, -S / 2, 0.0045);
  if (s === 'riviera') box(g, S - 0.012, S - 0.012, 0.002, m.brass, 0, -S / 2 + 0.006, 0.009);       // brass inlay frame
  const face = s === 'milano' ? m.applianceGlass : s === 'nordic' ? m.plastic : m.ceramic;
  // rocker / glass key: pivots about its horizontal middle axis
  const rk = mover(g, 0, 0, 0.011, { type: 'hinge', axis: 'x', angle: 0.12, dur: 160, group: id, curtain: true, part: 'curtainSwitch', tag: 'curtainSwitch' });
  const kh = S - 0.022, kw = S - 0.022;
  const key = grp(rk, 0, 0, 0); key.rotation.x = -0.06;
  box(key, kw, kh, 0.008, face, 0, -kh / 2, 0);
  if (s === 'nordic') box(key, kw - 0.01, 0.0015, 0.001, m.darkPlastic, 0, -0.0008, 0.0085);      // rocker split line
  // printed marks ▲ / ▼ (tiny dim bars) and the sliding status LED
  const mk = s === 'milano' ? m.steel : m.darkPlastic;
  box(key, 0.014, 0.0025, 0.001, mk, 0.012, kh * 0.18, 0.0085); box(key, 0.014, 0.0025, 0.001, mk, 0.012, -kh * 0.18 - 0.0025, 0.0085);
  // (a sibling of the rocker: a mover nested in another mover would just ride along with it)
  const led = mover(g, -0.016, -kh * 0.18 - 0.0035, 0.0205, { type: 'slide', dir: [0, 1, 0], dist: kh * 0.36 + 0.0025, dur: 220, group: id, curtain: true, proxy: false });
  box(led, 0.006, 0.004, 0.0015, s === 'milano' ? m.led : m.coldLed, 0, 0, 0);
  g.userData.noSolid = true; g.userData.ao = null;
  return g;
}
function throwBlanket(m, o = {}) { const g = new THREE.Group(); box(g, o.w || 0.5, 0.03, o.d || 0.4, m.throw, 0, 0, 0); g.userData.noSolid = true; return g; }

// ================================================================== OUTDOOR
function outdoorChair(m, o = {}) {
  const g = new THREE.Group(), s = m.fam;
  const fr = s === 'milano' ? m.blackMetal : m.teak;
  for (const [x, z] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]]) box(g, 0.04, 0.4, 0.04, fr, x, 0, z);
  box(g, 0.6, 0.04, 0.6, fr, 0, 0.36, 0);
  box(g, 0.6, 0.4, 0.04, fr, 0, 0.42, -0.28, [-0.25, 0, 0]);
  for (const sx of [-1, 1]) box(g, 0.05, 0.03, 0.6, fr, sx * 0.3, 0.6, 0);
  rbox(g, 0.54, 0.08, 0.54, 0.03, m.outdoorFabric, 0, 0.4, 0.02);
  rbox(g, 0.5, 0.36, 0.08, 0.03, m.outdoorFabric, 0, 0.47, -0.22, [-0.25, 0, 0]);
  cushion(g, 0.36, 0.3, 0.1, m.cushionA, 0.05, 0.52, -0.13, 0.1);
  g.userData.noSolid = true; g.userData.ao = { w: 0.72, d: 0.72 };
  return g;
}
function outdoorLounge(m, o = {}) {       // pair of lounge chairs + low table, fits 1.3 deep
  const W = o.w || 2.0, g = new THREE.Group();
  const a = outdoorChair(m); a.position.set(-W / 2 + 0.35, 0, 0); a.rotation.y = 0.35; g.add(a);
  const b = outdoorChair(m); b.position.set(W / 2 - 0.35, 0, 0); b.rotation.y = -0.35; g.add(b);
  const t = grp(g, 0, 0, 0.1);
  cyl(t, 0.25, 0.25, 0.03, m.fam === 'riviera' ? m.stone : m.teak, 0, 0.4, 0, 24);
  cyl(t, 0.04, 0.12, 0.4, m.fam === 'milano' ? m.blackMetal : m.teak, 0, 0, 0, 12);
  glass(t, m, -0.08, 0.43, 0.05, 'wine', true); glass(t, m, 0.08, 0.43, -0.03, 'wine', true);
  lathe(t, [[0, 0], [0.04, 0], [0.04, 0.22], [0.013, 0.28], [0.013, 0.33], [0, 0.33]], m.bottle, 0.0, 0.43, -0.12, 12);
  g.userData.solidBox = { w: W, d: 0.8, h: 0.7 };
  return g;
}
function outdoorTable(m, o = {}) {        // bistro table with 2 chairs
  const g = new THREE.Group(), s = m.fam;
  cyl(g, 0.35, 0.35, 0.03, s === 'riviera' ? m.stone : s === 'milano' ? m.marble : m.teak, 0, 0.72, 0, 28);
  rod(g, 0.025, 0.72, m.blackMetal, 0, 0.36, 0);
  cyl(g, 0.2, 0.22, 0.03, m.blackMetal, 0, 0, 0, 20);
  for (const sx of [-1, 1]) { const c = outdoorChair(m); c.scale.set(0.9, 0.95, 0.9); c.position.set(sx * 0.62, 0, 0); c.rotation.y = -sx * HALF; g.add(c); }
  glass(g, m, -0.1, 0.75, 0.05, 'wine', true); glass(g, m, 0.12, 0.75, -0.04, 'tumbler');
  bowl(g, m, 0.0, 0.75, -0.14, 0.1, m.ceramic, true);
  g.userData.solidBox = { w: 1.6, d: 0.7, h: 0.75 };
  return g;
}
function planter(m, o = {}) {             // long planter box with grasses / olive
  const L = o.len || 1.0, g = new THREE.Group(), s = m.fam;
  box(g, L, 0.5, 0.36, s === 'riviera' ? m.pot : s === 'milano' ? m.lacquer : m.pot2, 0, 0, 0);
  box(g, L - 0.04, 0.01, 0.32, m.soil, 0, 0.47, 0);
  const r = rngF((L * 97) | 0);
  const n = Math.round(L * 3);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * L / n;
    for (let j = 0; j < 9; j++) leaf(g, m, 'blade', 0.35 + r() * 0.35, 0.035, x + (r() - 0.5) * 0.1, 0.46, (r() - 0.5) * 0.14, 0.2 + r() * 0.5, r() * 6.28, 0, j % 2 ? m.leaf : m.leaf2);
  }
  g.userData.solidBox = { w: L, d: 0.36, h: 0.5 };
  return g;
}

// Paris: Carrara chimneypiece (jambs on plinths, panelled frieze, moulded shelf) around a cast-iron firebox with
// brass andirons, birch logs and pillar candles; on the shelf candlesticks and peonies; above it (o.mirror) a tall
// gilt-brass overmantel mirror with an arched head. Centred on x, back against z = -D/2.
function fireplace(m, o = {}) {
  const g = new THREE.Group(), W = o.w || 1.5, D = 0.34, zb = -D / 2, MH = o.tv ? 0.97 : 1.1, ow = W - 0.5, oh = MH - 0.3, M = m.marble;
  box(g, W + 0.2, 0.035, D + 0.12, M, 0, 0, 0.06);                                             // hearth
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.125);
    box(g, 0.25, 0.1, 0.25, M, x, 0.035, zb + 0.125); box(g, 0.21, oh - 0.1, 0.21, M, x, 0.135, zb + 0.105);
    box(g, 0.25, 0.06, 0.25, M, x, oh + 0.035, zb + 0.125);
    mouldFrame(g, m.brass, x, 0.2, oh - 0.02, 0.13, zb + 0.211, 0.008, 0.004);                  // brass inlay line on the jamb
  }
  box(g, W, MH - oh - 0.145, 0.23, M, 0, oh + 0.095, zb + 0.115);                               // frieze
  mouldFrame(g, m.brass, 0, oh + 0.118, MH - 0.075, ow - 0.06, zb + 0.231, 0.008, 0.004);
  box(g, ow + 0.03, 0.014, 0.012, m.brass, 0, oh + 0.035, zb + 0.016); for (const sx of [-1, 1]) box(g, 0.014, oh, 0.012, m.brass, sx * (ow / 2 + 0.008), 0.035, zb + 0.216);   // brass slip around the opening
  box(g, W + 0.06, 0.025, 0.27, M, 0, MH - 0.05, zb + 0.135); box(g, W + 0.16, 0.035, D, M, 0, MH - 0.025, 0);   // bed mould + shelf
  // firebox
  box(g, ow, oh + 0.06, 0.02, m.enamel, 0, 0.035, zb + 0.01);
  for (const sx of [-1, 1]) box(g, 0.02, oh + 0.06, 0.2, m.enamel, sx * (ow / 2 - 0.01), 0.035, zb + 0.1, [0, sx * 0.25, 0]);
  box(g, ow, 0.012, 0.2, m.enamel, 0, 0.035, zb + 0.1);
  for (const sx of [-1, 1]) { const ax = sx * (ow / 2 - 0.09); rod(g, 0.011, 0.34, m.brass, ax, 0.22, zb + 0.2, null, 8); sph(g, 0.03, m.brass, ax, 0.4, zb + 0.2, [1, 1, 1], 12); cyl(g, 0.03, 0.04, 0.02, m.brass, ax, 0.047, zb + 0.2, 12); }
  // a cluster of pillar candles on the hearth plate instead of a fire
  [[-0.2, 0.1, 0.26], [-0.09, 0.15, 0.36], [0.02, 0.09, 0.2], [0.12, 0.16, 0.3], [0.22, 0.11, 0.16], [-0.02, 0.2, 0.12]].forEach(([x, z, h]) => { const c = candle(g, m, x, 0.047, zb + z, h); void c; });
  fxQuad(g, m.lampGlow, 'lamp', [0, 0.36, zb + 0.022], [ow * 1.1, 0, 0], [0, oh * 1.2, 0]);
  fxFlat(g, m.glowFaint, 'disc', 0, 0.04, 0.16, 1.2, 0.8);
  bloom(g, 0, 0.3, zb + 0.16, 0.6, 0.35);
  // on the shelf
  if (o.tv) {            // a TV hangs above: only low pieces at the two ends of the shelf
    if (W / 2 > 0.84) { vase(g, m, W / 2 - 0.02, MH + 0.01, 0.02, 0.17, m.ceramic, true); bookStack(g, m, 2, -W / 2 + 0.02, MH + 0.01, 0.02, 17, 0.3); candle(g, m, -W / 2 + 0.03, MH + 0.07, 0.02, 0.07); }
  } else {
    for (const sx of [-1, 1]) { const x = sx * (W / 2 - 0.16); lathe(g, [[0.001, 0], [0.045, 0], [0.04, 0.012], [0.012, 0.03], [0.016, 0.1], [0.01, 0.16], [0.03, 0.18], [0.001, 0.18]], m.brass, x, MH + 0.01, -0.02, 14); candle(g, m, x, MH + 0.19, -0.02, 0.16); }
    vase(g, m, W * 0.2, MH + 0.01, 0, 0.22, m.ceramic, true); bookStack(g, m, 2, -W * 0.18, MH + 0.01, 0, 17, 0.2);
  }
  if (o.mirror) {
    const mw = W - 0.42, mh = Math.min(1.36, (o.ceil || 2.7) - MH - 0.2), y0 = MH + 0.012, R = mw / 2;
    const sh = (w, h, y) => { const s2 = new THREE.Shape(), r = w / 2; s2.moveTo(-r, y); s2.lineTo(r, y); s2.lineTo(r, y + h - r * 0.5); s2.absellipse(0, y + h - r * 0.5, r, r * 0.5, 0, Math.PI, false); s2.lineTo(-r, y); return s2; };
    add(g, cg(`omF${r3(mw)}|${r3(mh)}`, () => new THREE.ExtrudeGeometry(sh(mw, mh, 0), { depth: 0.035, bevelEnabled: false, curveSegments: 24 })), m.brass, 0, y0, zb);
    add(g, cg(`omM${r3(mw)}|${r3(mh)}`, () => new THREE.ShapeGeometry(sh(mw - 0.09, mh - 0.09, 0.045), 24)), m.mirror, 0, y0, zb + 0.036);
    add(g, cg(`omB${r3(mw)}|${r3(mh)}`, () => { const a = sh(mw - 0.07, mh - 0.07, 0.035); a.holes.push(sh(mw - 0.1, mh - 0.1, 0.05)); return new THREE.ExtrudeGeometry(a, { depth: 0.012, bevelEnabled: false, curveSegments: 24 }); }), m.brass, 0, y0, zb + 0.034);
    void R;
  }
  g.userData.solidBox = { w: W + 0.16, d: D, h: MH };
  return g;
}

// ================================================================== FITTED JOINERY (V7-furnish)
// Built-in pieces designed as one family: flush panel fronts with 3 mm reveals over a dark carcass (the reveals read
// as shadow gaps), a recessed plinth, edge pulls or handle-less fronts, open niches lined in wood with a warm LED
// line. Fronts / accent / pulls per style. All static (baked by material); the openable wardrobes are wardrobe().
function jSt(m) {
  const s = m.fam;
  return { s, front: s === 'riviera' ? m.lacquer2 : m.lacquer, accent: s === 'nordic' ? m.woodLight : m.woodDark, inner: s === 'nordic' ? m.woodLight : m.woodDark,
    pull: s === 'nordic' ? m.blackMetal : m.brass, core: m.darkPlastic };
}
// dark carcass body x0 … x1, y0 … y1, zb … zf (zf = the plane the fronts sit on)
function jCore(p, J, x0, x1, y0, y1, zb, zf) { if (x1 - x0 > 0.01 && y1 - y0 > 0.01) box(p, x1 - x0, y1 - y0, zf - zb - 0.001, J.core, (x0 + x1) / 2, y0, (zb + zf) / 2 - 0.0005); }
// flush front x0 … x1, y0 … y1 on the plane zf. o.pull: −1 / +1 = vertical edge pull on that edge, 'h' = drawer pull;
// o.mirror; o.mat
function jFront(p, m, J, x0, x1, y0, y1, zf, o = {}) {
  const w = x1 - x0 - 0.006, h = y1 - y0 - 0.006, cx = (x0 + x1) / 2;
  if (w < 0.02 || h < 0.02) return;
  box(p, w, h, 0.019, o.mat || J.front, cx, y0 + 0.003, zf + 0.0095);
  if (o.mirror) box(p, w - 0.03, h - 0.03, 0.004, m.mirror, cx, y0 + 0.018, zf + 0.021);
  else if (J.s === 'riviera' && w > 0.28 && h > 0.5 && o.cane !== false) box(p, w - 0.11, h - 0.11, 0.004, m.cane, cx, y0 + 0.058, zf + 0.0205);
  const knobM = m.styleId === 'paris' ? m.brass : m.woodDark;
  if (o.pull === 'h') {
    if (J.s === 'riviera') sph(p, 0.015, knobM, cx, y0 + h / 2, zf + 0.03, [1, 1, 0.7], 10);
    else box(p, Math.min(0.18, w * 0.4), 0.01, 0.016, J.pull, cx, y1 - 0.05, zf + 0.027);
  } else if (o.pull) {
    const px = cx + o.pull * (w / 2 - 0.032), ph = Math.min(o.pullLen || 0.34, h - 0.1), py = o.pullY ?? y0 + h / 2;
    if (J.s === 'riviera') sph(p, 0.016, knobM, px, py, zf + 0.03, [1, 1, 0.7], 10);
    else box(p, 0.011, ph, 0.016, J.pull, px, py - ph / 2, zf + 0.027);
  }
}
// LED line under a board + the wash it throws on the back panel
function jLed(p, m, cx, w, y, zb, drop = 0.45) {
  box(p, w, 0.006, 0.012, m.led, cx, y - 0.008, zb + 0.04);
  fxQuad(p, m.glow, 'grad', [cx, y - drop / 2, zb + 0.004], [w, 0, 0], [0, drop, 0]);
}
// Wall cabinets hung above a bed or a sofa. Origin: bottom edge at the wall (back at z = 0, front at +z); the caller
// hangs it at the height of its underside. o: len, d, hh (height), ends ('both' | 'none' | −1 | 1: finished end panels),
// brackets (a slim support under each end — a row hung alone), panel (m: a wall panel behind the bed head, down to
// the floor, o.panelW wide), led.
function overhead(m, o = {}) {
  const L = o.len || 1.8, D = o.d || 0.36, H = o.hh || 0.75, g = new THREE.Group(), J = jSt(m), zf = D - 0.019;
  jCore(g, J, -L / 2 + 0.004, L / 2 - 0.004, 0.022, H, 0, zf);
  for (const sx of [-1, 1]) box(g, 0.018, H, D, J.front, sx * (L / 2 - 0.009), 0, D / 2);
  box(g, L - 0.036, 0.018, zf - 0.03, J.front, 0, 0.004, (zf - 0.03) / 2);                       // underside, set back: the doors overhang it (finger grip)
  const n = Math.max(2, Math.round((L - 0.036) / 0.52)), dw = (L - 0.036) / n;
  for (let i = 0; i < n; i++) jFront(g, m, J, -L / 2 + 0.018 + i * dw, -L / 2 + 0.018 + (i + 1) * dw, 0, H, zf, { cane: false, mat: J.s === 'milano' && n > 2 && i % 3 === 1 ? m.woodDark : null });
  if (o.ceil > 0.005) box(g, L, o.ceil, 0.018, J.front, 0, H, D - 0.04);
  if (o.brackets) for (const sx of [-1, 1]) { box(g, 0.012, 0.16, 0.012, J.pull, sx * (L / 2 - 0.12), -0.16, 0.012); box(g, 0.012, 0.012, D * 0.7, J.pull, sx * (L / 2 - 0.12), -0.012, D * 0.35); }
  if (o.panel > 0) {
    const pw = o.panelW || L, ph = o.panel;
    box(g, pw, ph, 0.018, J.accent, 0, -ph, 0.009);
    if (J.s !== 'nordic') box(g, pw, 0.008, 0.02, J.pull, 0, -ph + (o.railY || 1.3), 0.012);
  }
  if (o.led !== false) {
    box(g, L - 0.14, 0.006, 0.014, m.led, 0, -0.004, 0.05);
    fxQuad(g, m.glow, 'grad', [0, -0.34, 0.021], [L - 0.1, 0, 0], [0, 0.66, 0]);
    bloom(g, 0, -0.03, 0.08, 0.5, 0.35);
  }
  g.userData.noSolid = true; g.userData.box3 = { w: L, d: D, h: H };
  return g;
}
// Side tower of a bridge unit (origin at the floor centre, front = +z): two drawers, an open bedside niche with a
// reading light, a tall door, and a top door level with the bridge. o: w, h, d, yB (underside of the bridge), side
// (−1: stands left of the bed — the pull is on the bed side), seed, ceil.
function tower(m, o = {}) {
  const W = o.w || 0.45, H = o.h || 2.75, D = o.d || 0.42, yB = o.yB || 1.95, g = new THREE.Group(), J = jSt(m), zb = -D / 2, zf = D / 2 - 0.019, side = o.side || -1;
  const x0 = -W / 2 + 0.018, x1 = W / 2 - 0.018, tall = H > 1.6;
  box(g, W - 0.03, 0.06, D - 0.07, m.darkPlastic, 0, 0, -0.025);
  for (const sx of [-1, 1]) box(g, 0.018, H - 0.06, D, J.front, sx * (W / 2 - 0.009), 0.06, 0);
  jCore(g, J, x0, x1, 0.06, 0.52, zb, zf);
  jFront(g, m, J, x0, x1, 0.06, 0.29, zf, { pull: 'h', cane: false }); jFront(g, m, J, x0, x1, 0.29, 0.52, zf, { pull: 'h', cane: false });
  const nT = Math.min(1.0, H - 0.02);
  // niche
  box(g, x1 - x0, 0.02, D - 0.004, J.inner, 0, 0.52, 0.002); box(g, x1 - x0, nT - 0.54, 0.012, J.inner, 0, 0.54, zb + 0.012);
  if (tall) {
    box(g, x1 - x0, 0.02, D - 0.004, J.inner, 0, nT - 0.02, 0.002);
    jLed(g, m, 0, x1 - x0 - 0.06, nT - 0.02, zb + 0.018, 0.4);
    fxFlat(g, m.glowFaint, 'rect', 0, 0.542, 0, x1 - x0, D - 0.04);
    const r = rngM(31 + (o.seed || 0) * 7), k = (r() * 3) | 0;
    if (k === 0) { bookStack(g, m, 2, -side * 0.04, 0.54, 0.02, 5 + (o.seed || 0), 0.3); glass(g, m, side * 0.11, 0.59, 0.08, 'tumbler'); }
    else if (k === 1) { vase(g, m, -side * 0.06, 0.54, 0, 0.2, m.ceramic, false); bookStack(g, m, 1, side * 0.08, 0.54, 0.06, 9 + (o.seed || 0), -0.2); }
    else { plantSmall(g, m, -side * 0.05, 0.54, 0, 0.22, r() * 3); candle(g, m, side * 0.1, 0.54, 0.07, 0.09); }
    const yD = Math.min(yB, H);
    jCore(g, J, x0, x1, nT, H, zb, zf);
    jFront(g, m, J, x0, x1, nT, yD, zf, { pull: -side, pullY: nT + 0.3, pullLen: 0.3 });
    if (H > yB + 0.2) jFront(g, m, J, x0, x1, yB, H, zf, { cane: false });
    if (o.ceil > 0.005) box(g, W, o.ceil, 0.018, J.front, 0, H, D / 2 - 0.04);
  }
  g.userData.solidBox = { w: W, d: D, h: H };
  return g;
}
// The open niche of an entrance wardrobe: bench with a cushion, shoe shelf under it, hooks, a top box.
function entryNiche(g, m, J, cx, W, H, D, o = {}) {
  const zb = -D / 2, zf = D / 2 - 0.019, x0 = cx - W / 2 + 0.018, x1 = cx + W / 2 - 0.018, w = x1 - x0, tall = H > 1.6, yT = tall ? H - 0.42 : H;
  box(g, W - 0.03, 0.06, D - 0.07, m.darkPlastic, cx, 0, -0.025);
  for (const sx of [-1, 1]) box(g, 0.018, H - 0.06, D, J.front, cx + sx * (W / 2 - 0.009), 0.06, 0);
  box(g, w, yT - 0.06, 0.012, J.inner, cx, 0.06, zb + 0.012);
  box(g, w, 0.02, D - 0.004, J.inner, cx, 0.06, 0.002); box(g, w, 0.018, D - 0.06, J.inner, cx, 0.24, -0.028);
  box(g, w, 0.04, D - 0.004, J.accent, cx, 0.43, 0.002);
  soft(g, w - 0.04, 0.05, D - 0.1, m.cushionA || m.linen, cx, 0.47, 0.0, null, { e: [0.1, 0.5, 0.12], sag: 0.004 });
  const W2 = (WEAR[m.styleId] || WEAR[m.fam]);
  shoePair(g, m, cx - w * 0.2, 0.08, 0.05, W2.bags[0], 'sneaker', 0.1); if (w > 0.5) shoePair(g, m, cx + w * 0.22, 0.08, 0.04, W2.bags[1], 'loafer', -0.08);
  shoePair(g, m, cx + w * 0.05, 0.258, 0.02, W2.bags[2], 'loafer', 0.05);
  if (!tall) return;
  // hooks on a rail, a bag on the bench
  box(g, w - 0.1, 0.06, 0.016, J.accent, cx, 1.62, zb + 0.026);
  const nH = Math.max(2, Math.round((w - 0.1) / 0.16));
  for (let i = 0; i < nH; i++) { const hx = cx - (w - 0.2) / 2 + (w - 0.2) * (nH === 1 ? 0.5 : i / (nH - 1)); rod(g, 0.007, 0.055, J.pull, hx, 1.65, zb + 0.06, [HALF, 0, 0], 8); sph(g, 0.012, J.pull, hx, 1.65, zb + 0.09, [1, 1, 1], 8); }
  handbag(g, m, cx + w * 0.18, 0.52, -0.04, W2.bags[3 % W2.bags.length], 0.25, 0.9);
  box(g, w, 0.02, D - 0.004, J.inner, cx, yT - 0.02, 0.002);
  jLed(g, m, cx, w - 0.08, yT - 0.02, zb + 0.018, 0.7);
  jCore(g, J, x0, x1, yT, H, zb, zf);
  const n = w > 0.75 ? 2 : 1;
  for (let i = 0; i < n; i++) jFront(g, m, J, x0 + i * w / n, x0 + (i + 1) * w / n, yT, H, zf, { cane: false });
  if (o.ceil > 0.005) box(g, W, o.ceil, 0.018, J.front, cx, H, D / 2 - 0.04);
}
// Entrance wardrobe: wardrobe() in its fitted version (sliding panels or hinged doors, one door a mirror, top boxes
// up to the ceiling) and, where the length allows (o.niche = its width, o.nicheSide = −1 / +1 the end it is on), the
// open niche with bench, shoe shelf and hooks.
function hallWardrobe(m, o = {}) {
  const L = o.len || 1.8, H = o.h || 2.75, D = o.d || 0.6, g = new THREE.Group(), J = jSt(m), tall = H > 1.6;
  const wn = o.niche && L - o.niche >= 0.8 ? o.niche : 0, ns = o.nicheSide || 1, Lw = L - wn;
  const sliding = o.sliding ?? Lw >= 1.5, nDoor = sliding ? Math.max(2, Math.round(Lw / 0.95)) : Math.max(2, Math.round(Lw / 0.5));
  // the mirror: the door next to the niche (or the first one)
  const mi = o.mirror === false ? -1 : ns > 0 ? nDoor - 1 : 0;
  const w = wardrobe(m, { len: Lw, h: H, d: D, kind: o.kind || 'hall', sliding, seed: o.seed, fitted: true, mirror: mi, ceil: o.ceil });
  w.position.x = -ns * wn / 2; g.add(w);
  if (wn) entryNiche(g, m, J, ns * (L / 2 - wn / 2), wn, H, D, { ceil: tall ? o.ceil : 0 });
  g.userData.solidBox = { w: L, d: D + (sliding ? 0.03 : 0), h: H, z: sliding ? 0.015 : 0 };
  g.userData.piece = 'wardrobe'; g.userData.hasNiche = !!wn; g.userData.hasMirror = mi >= 0 && tall;
  return g;
}
// Dressing-room fit-out: an open system along a wall — uprights, a top shelf with boxes, bays with hanging rails,
// shelves with folded stacks, a drawer base, shoes; an LED line under the top shelf of every bay.
function dressing(m, o = {}) {
  const L = o.len || 1.8, H = o.h || 2.75, D = o.d || 0.45, g = new THREE.Group(), J = jSt(m), zb = -D / 2, tall = H > 1.6;
  const n = Math.max(1, Math.round(L / 0.85)), bw = (L - 0.022) / n, yT = tall ? H - 0.42 : H - 0.03, W2 = (WEAR[m.styleId] || WEAR[m.fam]);
  const railM = J.pull;
  box(g, L, H, 0.012, m.cabinetIn, 0, 0, zb + 0.006);
  for (let i = 0; i <= n; i++) box(g, 0.022, H, D - 0.012, J.accent, -L / 2 + 0.011 + i * bw, 0, 0.006);
  box(g, L, 0.06, D - 0.06, m.darkPlastic, 0, 0, -0.02);
  if (tall) box(g, L, 0.022, D - 0.012, J.accent, 0, H - 0.022, 0.006);
  const types = D < 0.4 ? ['shelves', 'drawers', 'shelves'] : n === 1 ? ['double'] : ['long', 'drawers', 'double', 'shelves'];
  for (let i = 0; i < n; i++) {
    const xa = -L / 2 + 0.022 + i * bw, xb = xa + bw - 0.022, x = (xa + xb) / 2, w = xb - xa, type = types[(i + (o.seed || 0)) % types.length], seed = 7 + i * 13 + (o.seed || 0) * 5, r = rngM(seed);
    box(g, w, 0.02, D - 0.02, J.accent, x, 0.06, 0.004);
    if (tall) {
      box(g, w, 0.022, D - 0.02, J.accent, x, yT, 0.004);
      let xx = xa + 0.03; while (xx < xb - 0.34) { shoeBox(g, m, xx + 0.17, yT + 0.022, 0, W2.boxes[((xx * 7 + i) | 0) % W2.boxes.length], 0.34, Math.min(0.22, H - yT - 0.09), Math.min(0.3, D - 0.1)); xx += 0.38; }
      ledWash(g, m, x, w, 0.08, yT, zb + 0.012, D / 2 - 0.02);
    }
    if (!tall) { foldStack(g, m, x, 0.08, 0, 3, seed, Math.min(0.3, w - 0.08), Math.min(0.27, D - 0.1)); continue; }
    const rail = (y, mix, maxLen) => { rod(g, 0.011, w, railM, x, y, 0.01, [0, 0, HALF], 12); hangRail(g, m, xa + 0.02, xb - 0.02, y, 0.01, seed + (y * 10 | 0), mix, maxLen); };
    if (type === 'long') { rail(yT - 0.07, ['dress', 'coat', 'dress', 'jacket'], yT - 0.5); for (let k = 0, sx = xa + 0.14; sx < xb - 0.12; k++, sx += 0.26) shoePair(g, m, sx, 0.08, 0.06, W2.bags[(k + i) % W2.bags.length], k % 2 ? 'heel' : 'loafer', (r() - 0.5) * 0.2); }
    else if (type === 'double') { rail(yT - 0.07, ['shirt', 'shirt', 'jacket', 'shirt'], 0.85); rail(Math.min(1.12, yT * 0.5), ['trousers', 'shirt'], 0.8); for (let k = 0, sx = xa + 0.14; sx < xb - 0.12; k++, sx += 0.26) shoePair(g, m, sx, 0.08, 0.06, W2.bags[(k + 2 + i) % W2.bags.length], k % 2 ? 'sneaker' : 'loafer', (r() - 0.5) * 0.2); }
    else {
      let y = 0.08;
      if (type === 'drawers') {
        const zf = D / 2 - 0.025;
        jCore(g, J, xa, xb, 0.08, 0.8, zb + 0.012, zf);
        for (let k = 0; k < 3; k++) jFront(g, m, J, xa, xb, 0.08 + k * 0.24, 0.08 + (k + 1) * 0.24, zf, { pull: 'h', cane: false });
        box(g, w, 0.022, D - 0.02, J.accent, x, 0.8, 0.004); y = 0.822;
        handbag(g, m, x - w * 0.2, y, 0, W2.bags[i % W2.bags.length], 0.2); if (w > 0.6) handbag(g, m, x + w * 0.2, y, 0.02, W2.bags[(i + 2) % W2.bags.length], -0.15, 0.85);
        y += 0.36;
      }
      const ns = Math.max(1, Math.round((yT - y) / 0.36));
      for (let k = type === 'drawers' ? 0 : 1; k < ns; k++) {
        const yy = y + k * (yT - y) / ns;
        box(g, w, 0.02, D - 0.03, J.accent, x, yy, 0);
        const cnt = w > 0.6 ? 2 : 1;
        if ((k + i) % 3 === 2) { for (let sx = xa + 0.19; sx < xb - 0.17; sx += 0.37) shoeBox(g, m, sx, yy + 0.02, 0, W2.boxes[((k + sx * 10) | 0) % W2.boxes.length], 0.34, 0.13, Math.min(0.21, D - 0.12)); }
        else for (let j = 0; j < cnt; j++) foldStack(g, m, xa + (j + 0.5) * w / cnt, yy + 0.02, 0.02, 3 + (r() * 3 | 0), seed + k * 5 + j, Math.min(0.3, w / cnt - 0.06), Math.min(0.27, D - 0.1));
      }
      if (type !== 'drawers') for (let k = 0, sx = xa + 0.14; sx < xb - 0.12; k++, sx += 0.26) shoePair(g, m, sx, 0.08, 0.04, W2.bags[(k + 1 + i) % W2.bags.length], k % 2 ? 'loafer' : 'sneaker', (r() - 0.5) * 0.2);
    }
  }
  g.userData.solidBox = { w: L, d: D, h: H };
  return g;
}
// Tall pantry cabinet at the end of a kitchen run (fronts and pulls of the kitchen).
function pantry(m, o = {}) {
  const W = o.w || 0.6, H = o.h || 2.3, D = o.d || 0.6, g = new THREE.Group(), J = jSt(m), zb = -D / 2, zf = D / 2 - 0.019, x0 = -W / 2 + 0.018, x1 = W / 2 - 0.018;
  box(g, W - 0.03, 0.1, D - 0.08, m.darkPlastic, 0, 0, -0.03);
  for (const sx of [-1, 1]) box(g, 0.018, H - 0.1, D, m.lacquer, sx * (W / 2 - 0.009), 0.1, 0);
  jCore(g, J, x0, x1, 0.1, H, zb, zf);
  const J2 = { ...J, front: m.lacquer }, yM = Math.min(1.42, H - 0.02), side = o.side || 1;
  jFront(g, m, J2, x0, x1, 0.1, yM, zf, { cane: false }); handle(g, m, side * (W / 2 - 0.06), yM - 0.25, zf + 0.019, 0.3, true);
  if (H > 1.6) {
    const yU = Math.min(2.2, H - 0.3);
    jFront(g, m, J2, x0, x1, yM, yU, zf, { cane: false }); handle(g, m, side * (W / 2 - 0.06), yM + 0.25, zf + 0.019, 0.3, true);
    jFront(g, m, J2, x0, x1, yU, H, zf, { cane: false });
    if (o.ceil > 0.005) box(g, W, o.ceil, 0.018, m.lacquer, 0, H, D / 2 - 0.04);
  }
  g.userData.solidBox = { w: W, d: D, h: H };
  return g;
}
// Cupboard over a washing machine that stands in a niche: side cheeks, a worktop, an open shelf with towels and a
// light, doors up to the ceiling. Origin = the washer's floor centre; nothing of it stands on new floor.
function washerCab(m, o = {}) {
  const W = o.w || 0.636, H = o.h || 2.75, D = o.d || 0.6, g = new THREE.Group(), J = jSt(m), zb = -D / 2, zf = D / 2 - 0.019, x0 = -W / 2 + 0.016, x1 = W / 2 - 0.016;
  for (const sx of [-1, 1]) box(g, 0.016, H, D, J.front, sx * (W / 2 - 0.008), 0, 0);
  box(g, x1 - x0, 0.03, D, m.counter || J.accent, 0, 0.87, 0);
  box(g, x1 - x0, 0.42, 0.012, J.inner, 0, 0.9, zb + 0.008);
  towelRoll(g, m, -0.12, 0.9, 0.02, m.towel || m.linen, 0.28); towelRoll(g, m, -0.12, 0.99, 0.02, m.towel2 || m.towel || m.linen, 0.28); towelRoll(g, m, 0.14, 0.9, 0.0, m.towel2 || m.linen, 0.26);
  box(g, x1 - x0, 0.02, D - 0.004, J.inner, 0, 1.32, 0.002);
  jLed(g, m, 0, x1 - x0 - 0.06, 1.32, zb + 0.014, 0.38);
  jCore(g, J, x0, x1, 1.34, H, zb, zf);
  const yU = Math.max(1.9, H - 0.6), mid = (x0 + x1) / 2;
  jFront(g, m, J, x0, mid, 1.34, yU, zf, { pull: 1, pullY: 1.5, pullLen: 0.2, cane: false }); jFront(g, m, J, mid, x1, 1.34, yU, zf, { pull: -1, pullY: 1.5, pullLen: 0.2, cane: false });
  jFront(g, m, J, x0, x1, yU, H, zf, { cane: false });
  if (o.ceil > 0.005) box(g, W, o.ceil, 0.018, J.front, 0, H, D / 2 - 0.04);
  g.userData.noSolid = true; g.userData.box3 = { w: W, d: D, h: H, y0: 0.87 };
  return g;
}
// Slim shelf tower (beside the TV unit, in a larger bedroom): a door below, open lit shelves, a top box.
function shelfTower(m, o = {}) {
  const W = o.w || 0.5, H = o.h || 2.75, D = o.d || 0.32, g = new THREE.Group(), J = jSt(m), zb = -D / 2, zf = D / 2 - 0.019, x0 = -W / 2 + 0.018, x1 = W / 2 - 0.018, w = x1 - x0, tall = H > 1.6;
  box(g, W - 0.03, 0.06, D - 0.06, m.darkPlastic, 0, 0, -0.02);
  for (const sx of [-1, 1]) box(g, 0.018, H - 0.06, D, J.front, sx * (W / 2 - 0.009), 0.06, 0);
  const yL = Math.min(0.74, H - 0.02);
  jCore(g, J, x0, x1, 0.06, yL, zb, zf); jFront(g, m, J, x0, x1, 0.06, yL, zf, { pull: o.side || 1, pullY: yL - 0.2, pullLen: 0.22 });
  if (!tall) { g.userData.solidBox = { w: W, d: D, h: H }; return g; }
  const yT = H - 0.42, nS = Math.max(2, Math.round((yT - yL) / 0.4)), sh = (yT - yL) / nS;
  box(g, w, yT - yL, 0.012, J.inner, 0, yL, zb + 0.012);
  for (let k = 0; k <= nS; k++) {
    const y = yL + k * sh;
    box(g, w, 0.02, D - 0.004, J.inner, 0, y - (k === nS ? 0.02 : 0), 0.002);
    if (k === nS) break;
    const top = y + 0.02, mode = (k + (o.seed || 0)) % 4;
    if (mode === 0) bookRow(g, m, x0 + 0.02, w - 0.14, top, 0, 3 + k * 7 + (o.seed || 0), Math.min(0.28, sh - 0.08));
    else if (mode === 1) { vase(g, m, -w * 0.15, top, 0, Math.min(0.24, sh - 0.1), k % 2 ? m.ceramic2 : m.ceramic, false); bookStack(g, m, 3, w * 0.18, top, 0, k * 5 + 2, 0.2); }
    else if (mode === 2) { bookStack(g, m, 2, -w * 0.12, top, 0, k * 3 + 1, -0.15); plantSmall(g, m, w * 0.2, top, 0, Math.min(0.24, sh - 0.1), k); }
    else { const e = bookRow(g, m, x0 + 0.02, w * 0.5, top, 0, 11 + k * 5, Math.min(0.26, sh - 0.08)); sph(g, 0.05, m.ceramic2 || m.ceramic, Math.min(x1 - 0.07, e + 0.09), top + 0.05, 0, [1, 1, 1], 12); }
    if (k % 2 === 1 || k === nS - 1) jLed(g, m, 0, w - 0.06, y + sh - 0.02, zb + 0.018, sh - 0.06);
  }
  jCore(g, J, x0, x1, yT, H, zb, zf); jFront(g, m, J, x0, x1, yT, H, zf, { cane: false });
  if (o.ceil > 0.005) box(g, W, o.ceil, 0.018, J.front, 0, H, D / 2 - 0.04);
  g.userData.solidBox = { w: W, d: D, h: H };
  return g;
}
// Two floating shelves over a desk (back at z = 0; the caller hangs it at the lower board's height).
function wallShelves(m, o = {}) {
  const L = o.len || 1.0, g = new THREE.Group(), J = jSt(m), D = 0.22;
  for (const [y, k] of [[0, 0], [0.38, 1]]) {
    box(g, L, 0.03, D, J.accent, 0, y, D / 2);
    if (k === 0) { const e = bookRow(g, m, -L / 2 + 0.04, L * 0.5, y + 0.03, D / 2, 5 + (o.seed || 0), 0.26); vase(g, m, Math.min(L / 2 - 0.1, e + 0.14), y + 0.03, D / 2, 0.18, m.ceramic, false); }
    else { bookStack(g, m, 3, -L * 0.22, y + 0.03, D / 2, 9 + (o.seed || 0), 0.2); plantSmall(g, m, L * 0.25, y + 0.03, D / 2, 0.2, 1); }
  }
  box(g, L - 0.1, 0.005, 0.012, m.led, 0, -0.005, 0.03);
  fxQuad(g, m.glow, 'grad', [0, -0.2, 0.004], [L - 0.06, 0, 0], [0, 0.4, 0]);
  g.userData.noSolid = true; g.userData.box3 = { w: L, d: D, h: 0.6 };
  return g;
}

const F0 = {
  fireplace,
  sofa, sofaBed, armchair, coffeeTable, sideTable, diningTable, diningChair, tableSetting, stool, tvUnit, tv, bookshelf, sideboard,
  bed, nightstand, wardrobe, desk, overhead, tower, hallWardrobe, dressing, pantry, washerCab, shelfTower, wallShelves,
  kitchenRun, island, fridge, oven, hob, hood, dishwasher, microwave, washer, sink, coffeeMachine,
  bathtub, shower, toilet, vanity, mirror, towelRail,
  plant, floorLamp, pendant, rug, artFrame, curtains, motorCurtains, curtainSwitch, throwBlanket, laundryTower,
  outdoorLounge, outdoorTable, outdoorChair, planter,
};
// every piece knows its name (openable fronts report which piece they belong to: 'wardrobe', 'fridge', …)
export const F = {};
for (const [k, fn] of Object.entries(F0)) F[k] = (...args) => { const g = fn(...args); if (!g.userData.piece) g.userData.piece = k; return g; };
// small helpers reused by apartment.js (decor on shelves / walls)
export const FX = { mouldFrame, bloom, box, rbox, cyl, rod, sph, lathe, torus, disc, plane, grp, bookRow, bookStack, vase, candle, bowl, plantSmall, sconce, tableLamp, tap, glass, plate, HALF,
  soft, softGeo, clothGeo, fxQuad, fxFlat, fxWallZ, sofaBedSize };
