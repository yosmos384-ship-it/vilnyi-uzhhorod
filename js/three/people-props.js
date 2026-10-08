// people-props.js — the things people have with them: walking cane, pram, dog (with a lead), bicycle, e-scooter.
// Each kind is one InstancedMesh (one draw call per kind in view), built from primitives with baked vertex colours;
// the instance colour tints the light parts (dog's coat, pram body, bicycle frame).
// createProps(parent, cap) → { begin(), put(kind, x, y, z, yaw, scale, colour, roll, pitch), lead(ax, ay, az, bx, by, bz), end(), stats(), dispose() }
import * as THREE from 'three';

function builder() {
  const pos = [], nor = [], col = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), n3 = new THREE.Matrix3();
  const add = (geo, x, y, z, rx = 0, ry = 0, rz = 0, c = [1, 1, 1], sx = 1, sy = 1, sz = 1) => {
    const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal;
    m.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)); n3.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z); v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize(); nor.push(v.x, v.y, v.z); col.push(c[0], c[1], c[2]); }
    if (g !== geo) g.dispose(); geo.dispose();
  };
  const box = (w, h, d, ...a) => add(new THREE.BoxGeometry(w, h, d), ...a), cyl = (r, h, ...a) => add(new THREE.CylinderGeometry(r, r, h, 8), ...a), ball = (r, ...a) => add(new THREE.SphereGeometry(r, 8, 6), ...a);
  const wheel = (r, x, y, z, w = 0.04, c = [0.05, 0.05, 0.055]) => add(new THREE.CylinderGeometry(r, r, w, 12), x, y, z, 0, 0, Math.PI / 2, c);
  const ring = (r, x, y, z) => { add(new THREE.TorusGeometry(r, 0.018, 5, 16), x, y, z, 0, Math.PI / 2, 0, [0.05, 0.05, 0.055]); for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.004, 0.004, r * 2, 4), x, y, z, i * Math.PI / 4, 0, 0, [0.6, 0.6, 0.62]); };
  const geometry = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeBoundingSphere(); return g; };
  return { add, box, cyl, ball, wheel, ring, geometry };
}
const DARK = [0.08, 0.08, 0.09], STEEL = [0.55, 0.56, 0.58], W = [1, 1, 1];
// Every prop: origin on the ground, facing +z.
const BUILD = {
  cane(b) { b.cyl(0.011, 0.86, 0, 0.43, 0, 0, 0, 0, [0.32, 0.2, 0.11]); b.cyl(0.013, 0.11, 0, 0.865, -0.03, Math.PI / 2, 0, 0, [0.25, 0.15, 0.08]); b.cyl(0.014, 0.03, 0, 0.015, 0, 0, 0, 0, DARK); },
  pram(b) {
    b.box(0.46, 0.3, 0.74, 0, 0.62, 0.05, 0, 0, 0, W); b.box(0.42, 0.04, 0.7, 0, 0.455, 0.05, 0, 0, 0, DARK);
    b.add(new THREE.SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.74, -0.14, -0.5, 0, 0, W, 0.94, 1, 1);                                   // hood
    for (const sx of [-1, 1]) { b.wheel(0.13, sx * 0.25, 0.13, 0.32); b.wheel(0.13, sx * 0.25, 0.13, -0.26); b.cyl(0.012, 0.42, sx * 0.21, 0.3, 0.03, 0.9, 0, 0, STEEL); b.cyl(0.012, 0.42, sx * 0.21, 0.3, 0.03, -0.9, 0, 0, STEEL); b.cyl(0.012, 0.62, sx * 0.2, 0.84, -0.5, -0.75, 0, 0, STEEL); }
    b.cyl(0.014, 0.42, 0, 1.02, -0.71, 0, 0, Math.PI / 2, DARK);
  },
  dog(b) {
    b.add(new THREE.CapsuleGeometry(0.1, 0.34, 3, 8), 0, 0.36, 0, Math.PI / 2, 0, 0, W); b.ball(0.085, 0, 0.5, 0.27, 0, 0, 0, W, 0.9, 0.95, 1.1); b.box(0.07, 0.06, 0.1, 0, 0.47, 0.37, 0, 0, 0, W); b.ball(0.02, 0, 0.485, 0.425, 0, 0, 0, DARK);
    for (const sx of [-1, 1]) { b.box(0.03, 0.09, 0.05, sx * 0.065, 0.57, 0.24, 0, 0, sx * 0.35, [0.75, 0.72, 0.7]); b.ball(0.013, sx * 0.04, 0.525, 0.345, 0, 0, 0, DARK); for (const z of [0.16, -0.17]) b.cyl(0.026, 0.3, sx * 0.065, 0.15, z, 0, 0, 0, W); }
    b.cyl(0.016, 0.2, 0, 0.47, -0.3, -0.9, 0, 0, W); b.cyl(0.092, 0.025, 0, 0.44, 0.19, Math.PI / 2 - 0.5, 0, 0, [0.7, 0.1, 0.1]);
  },
  bike(b) {
    b.ring(0.33, 0, 0.33, 0.52); b.ring(0.33, 0, 0.33, -0.5);
    const tube = (y0, z0, y1, z1, c = W, r = 0.016) => { const l = Math.hypot(y1 - y0, z1 - z0); b.cyl(r, l, 0, (y0 + y1) / 2, (z0 + z1) / 2, Math.atan2(z1 - z0, y1 - y0), 0, 0, c); };
    tube(0.33, -0.5, 0.3, -0.08); tube(0.3, -0.08, 0.86, -0.22); tube(0.86, -0.22, 0.33, -0.5, W, 0.011); tube(0.3, -0.08, 0.82, 0.36); tube(0.86, -0.22, 0.86, 0.33); tube(0.33, 0.52, 0.98, 0.3, STEEL);
    b.cyl(0.012, 0.5, 0, 0.99, 0.3, 0, 0, Math.PI / 2, DARK); b.box(0.13, 0.04, 0.25, 0, 0.92, -0.26, 0, 0, 0, DARK); b.cyl(0.05, 0.02, 0.03, 0.3, -0.08, 0, 0, Math.PI / 2, STEEL);
    b.cyl(0.008, 0.32, 0.07, 0.3, -0.08, 0.6, 0, 0, STEEL);
  },
  scooter(b) {
    b.wheel(0.1, 0, 0.1, 0.42, 0.05); b.wheel(0.1, 0, 0.1, -0.38, 0.05); b.box(0.15, 0.04, 0.62, 0, 0.13, 0, 0, 0, 0, DARK); b.box(0.13, 0.012, 0.46, 0, 0.155, -0.02, 0, 0, 0, [0.2, 0.2, 0.2]);
    b.cyl(0.02, 1.0, 0, 0.62, 0.36, -0.1, 0, 0, W); b.cyl(0.014, 0.42, 0, 1.11, 0.31, 0, 0, Math.PI / 2, DARK); b.box(0.06, 0.1, 0.03, 0, 0.3, 0.44, 0, 0, 0, W);
  },
  lead(b) { b.add(new THREE.CylinderGeometry(0.006, 0.006, 1, 5), 0, 0.5, 0, 0, 0, 0, [0.2, 0.12, 0.08]); },               // unit length along +y
};
export const PROP_KINDS = Object.keys(BUILD);

export function createProps(parent, cap = 48) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true }), T = {}, M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), D = new THREE.Vector3();
  for (const k of PROP_KINDS) { const b = builder(); BUILD[k](b); const geo = b.geometry(), mesh = new THREE.InstancedMesh(geo, mat, cap); mesh.count = 0; mesh.frustumCulled = false; mesh.name = 'vrc-people-prop-' + k; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, C.set(0xffffff)); parent.add(mesh); T[k] = { mesh, geo, n: 0, tris: geo.attributes.position.count / 3 }; }
  return {
    begin() { for (const k of PROP_KINDS) T[k].n = 0; },
    put(kind, x, y, z, yaw = 0, scale = 1, colour = 0xffffff, roll = 0, pitch = 0) { const t = T[kind]; if (!t || t.n >= cap) return; E.set(pitch, yaw, roll); M.compose(V.set(x, y, z), Q.setFromEuler(E), S.set(scale, scale, scale)); t.mesh.setMatrixAt(t.n, M); t.mesh.setColorAt(t.n, C.set(colour)); t.n++; },
    lead(ax, ay, az, bx, by, bz) { const t = T.lead; if (t.n >= cap) return; D.set(bx - ax, by - ay, bz - az); const l = D.length() || 0.01; Q.setFromUnitVectors(up, D.multiplyScalar(1 / l)); M.compose(V.set(ax, ay, az), Q, S.set(1, l, 1)); t.mesh.setMatrixAt(t.n, M); t.mesh.setColorAt(t.n, C.set(0xffffff)); t.n++; },
    end() { let calls = 0, tris = 0; for (const k of PROP_KINDS) { const t = T[k]; t.mesh.count = t.n; t.mesh.visible = t.n > 0; if (t.n) { calls++; tris += t.n * t.tris; t.mesh.instanceMatrix.needsUpdate = true; if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true; } } return { calls, tris }; },
    dispose() { for (const k of PROP_KINDS) { T[k].geo.dispose(); T[k].mesh.parent?.remove(T[k].mesh); T[k].mesh.dispose?.(); } mat.dispose(); },
  };
}
