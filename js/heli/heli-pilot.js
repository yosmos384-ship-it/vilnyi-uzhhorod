// heli-pilot.js — V26: the pilot. An adult woman (≈ 34) with long blonde hair, in a dark one-piece flight suit, boots,
// an aviation headset with boom microphone and aviator sunglasses — a professional look, nothing else emphasised.
// Built on the site's own people generator (people-body.js: seeded body, painted face, skeleton, walk cycle); the helmet,
// boom microphone and suit details are added here. Animated by the cut-scene of heli-app.js (walk → door → climb → sit).
import * as THREE from 'three';
import { makeTraits, makeFigure, poseWalk, poseStatic, newPose, blendPose } from '../three/people-body.js';

const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
/** Replaces the colour markers: the V of the open top → skin above the bust line, top colour below (a deep V neckline);
 *  the shorts → dark briefs on the body + a separate sheer white layer (skinned to the same skeleton) a few mm outside. */
function outfitPass(fig, T, suit) {
  const g = fig.mesh.geometry, col = g.attributes.color, pos = g.attributes.position, nor = g.attributes.normal, n = col.count, K = fig.K, s = K.s;
  const skin = T.skin.map(lin), top = suit.map(lin), brief = [0.012, 0.012, 0.014], isShorts = new Uint8Array(n);
  const vLow = K.y.chest - 0.035 * s;
  for (let i = 0; i < n; i++) {
    const r = col.getX(i), gg = col.getY(i), b = col.getZ(i), sh = Math.max(r, gg, b);
    if (sh <= 0) continue;
    if (gg < 1e-4 && r > 0 && Math.abs(r - b) < 1e-3) { const c = pos.getY(i) > vLow ? skin : top; col.setXYZ(i, c[0] * sh, c[1] * sh, c[2] * sh); }
    else if (r < 1e-4 && gg > 0 && Math.abs(gg - b) < 1e-3) { isShorts[i] = 1; col.setXYZ(i, brief[0] * sh * 3, brief[1] * sh * 3, brief[2] * sh * 3); }
  }
  col.needsUpdate = true;
  const idx = g.index.array, sub = [];
  for (let i = 0; i < idx.length; i += 3) if (isShorts[idx[i]] && isShorts[idx[i + 1]] && isShorts[idx[i + 2]]) sub.push(idx[i], idx[i + 1], idx[i + 2]);
  if (!sub.length) return null;
  const sg = new THREE.BufferGeometry(), P = new Float32Array(pos.array.length);
  for (let i = 0; i < n; i++) { const k = isShorts[i] ? 0.006 : 0; P[i * 3] = pos.getX(i) + nor.getX(i) * k; P[i * 3 + 1] = pos.getY(i) + nor.getY(i) * k; P[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * k; }
  sg.setAttribute('position', new THREE.BufferAttribute(P, 3)); sg.setAttribute('normal', nor); sg.setAttribute('skinIndex', g.attributes.skinIndex); sg.setAttribute('skinWeight', g.attributes.skinWeight);
  sg.setIndex(sub); sg.boundingSphere = g.boundingSphere.clone(); sg.boundingBox = g.boundingBox.clone();
  const sm = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.55, transparent: true, opacity: 0.62, depthWrite: false });
  const mesh = new THREE.SkinnedMesh(sg, sm); mesh.name = 'pilot-shorts'; mesh.frustumCulled = false; mesh.renderOrder = 2;
  mesh.bind(fig.rig.skeleton, fig.mesh.bindMatrix); fig.mesh.parent ? fig.mesh.parent.add(mesh) : null;
  return { mesh, geo: sg, mat: sm };
}

export function createPilot() {
  const T = makeTraits(260926, { role: 'civil', gender: 'f', age: 34 });
  T.height = 1.71; T.build = -0.1; T.stoop = 0; T.kid = 0;
  T.hairName = 'blond'; T.hair = [0.84, 0.70, 0.45]; T.hairStyle = 'long'; T.fringe = false;
  T.glasses = null; T.makeup = 0.15; T.freckles = false; T.acc = { bag: null }; T.beard = 'none';
  T.skinDepth = 0.12;
  const suit = [0.24, 0.27, 0.32];
  // outfit (owner's choice, confirmed 28 Oct): fitted short-sleeve pilot top with a low V neckline, sheer short shorts over
  // fully covering dark briefs, ankle boots. Non-explicit. The colour markers below are replaced after the body is built.
  const MARK_V = [1, 0, 1], MARK_SHORTS = [0, 1, 1];
  T.outfit = { top: 'tee', topCol: suit, inner: MARK_V, open: true, sleeves: 'short', tucked: true, bottom: 'shorts', bottomCol: MARK_SHORTS, skirtLen: 0, shoes: [0.07, 0.07, 0.08], heel: 0, legsBare: true, tie: false, hat: null, band: suit };
  const fig = makeFigure(T, { faceSize: 256 });
  const group = new THREE.Group(); group.name = 'heli-pilot'; group.add(fig.mesh);
  const sheer = outfitPass(fig, T, suit); if (sheer) group.add(sheer.mesh);
  fig.mesh.castShadow = false;
  const own = [];
  // helmet on the head bone (visor up), headset boom; a name tape and a shoulder patch on the suit would be too small to read → none
  const head = fig.rig.bones[4], hH = T.headH;
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: '#2b2e33', metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12 });
  const visorMat = new THREE.MeshPhysicalMaterial({ color: '#141619', metalness: 0.6, roughness: 0.08, clearcoat: 1 });
  const blackMat = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.6 });
  own.push(helmetMat, visorMat, blackMat);
  {
    // aviation headset (band over the top, large ear cups, boom microphone) — the long hair stays visible
    const band = new THREE.TorusGeometry(hH * 0.56, hH * 0.045, 6, 20, Math.PI); band.scale(1, 1.08, 1);
    const bm = new THREE.Mesh(band, helmetMat); bm.position.set(0, hH * 0.5, -hH * 0.02); head.add(bm); own.push(band);
    for (const s of [-1, 1]) {
      const cup = new THREE.CylinderGeometry(hH * 0.24, hH * 0.24, hH * 0.16, 16); cup.rotateZ(Math.PI / 2);
      const c = new THREE.Mesh(cup, helmetMat); c.position.set(s * hH * 0.56, hH * 0.45, -hH * 0.02); head.add(c); own.push(cup);
      const pad = new THREE.TorusGeometry(hH * 0.19, hH * 0.05, 6, 16); pad.rotateY(Math.PI / 2);
      const pm = new THREE.Mesh(pad, blackMat); pm.position.set(s * hH * 0.49, hH * 0.45, -hH * 0.02); head.add(pm); own.push(pad);
    }
    const boom = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(hH * 0.6, hH * 0.4, hH * 0.08), new THREE.Vector3(hH * 0.52, hH * 0.18, hH * 0.42), new THREE.Vector3(hH * 0.14, hH * 0.16, hH * 0.56)), 8, 0.0045, 5);
    head.add(new THREE.Mesh(boom, blackMat)); own.push(boom);
    const mic = new THREE.SphereGeometry(0.013, 8, 6); const mm = new THREE.Mesh(mic, blackMat); mm.position.set(hH * 0.14, hH * 0.16, hH * 0.56); head.add(mm); own.push(mic);
    // long hair falling over the back (blonde), under the headset band
    const hairMat = new THREE.MeshStandardMaterial({ color: '#cfae74', roughness: 0.62, metalness: 0.05 }); own.push(hairMat);
    const lock = new THREE.CapsuleGeometry(hH * 0.33, hH * 1.25, 6, 14); lock.scale(1.05, 1, 0.42);
    { const p = lock.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 1 - Math.max(0, -y) / (hH * 1.4) * 0.35; p.setX(i, p.getX(i) * k); } lock.computeVertexNormals(); }
    const hm = new THREE.Mesh(lock, hairMat); hm.position.set(0, hH * 0.02 - hH * 0.35, -hH * 0.34); hm.rotation.x = 0.12; head.add(hm); own.push(lock);
    // aviator sunglasses (dark lenses, thin metal frame)
    for (const s of [-1, 1]) { const lens = new THREE.CircleGeometry(hH * 0.105, 14); lens.scale(1.15, 0.9, 1); const l = new THREE.Mesh(lens, visorMat); l.position.set(s * hH * 0.13, hH * 0.47, hH * 0.47); l.rotation.y = s * 0.12; head.add(l); own.push(lens); }
    const bridge = new THREE.BoxGeometry(hH * 0.1, 0.004, 0.004); const br = new THREE.Mesh(bridge, helmetMat); br.position.set(0, hH * 0.51, hH * 0.48); head.add(br); own.push(bridge);
  }
  const P = fig.pose, tmpA = newPose(), tmpB = newPose(), K = fig.K;
  const sitP = poseStatic(newPose(), 'drive', K), standP = poseStatic(newPose(), 'stand', K), pushP = poseStatic(newPose(), 'push', K);
  const seatHipY = (seatY) => seatY - (K.y.hip + sitP[0]);
  return {
    group, fig, T, K,
    /** walking: phase advances with distance (one stride ≈ 1.45 m) */
    walk(phase, amp = 1) { poseWalk(P, phase, amp, K); fig.apply(); },
    stand() { P.set(standP); fig.apply(); },
    /** reach for the door handle (k 0..1) */
    reach(k) { blendPose(P, standP, pushP, k); P[13] *= 1.0; P[9] = standP[9]; P[11] = standP[11]; fig.apply(); },
    /** inviting gesture (k 0..1): open hand towards the door, slight turn of the body and head */
    invite(k) { P.set(standP); P[13] = 0.75 * k; P[14] = 0.55 * k; P[15] = 0.35 * k; P[16] = -0.4 * k; P[5] = -0.25 * k; P[7] = 0.2 * k; fig.apply(); },
    /** climbing: k 0..1 from standing to seated; extra knee lift in the middle */
    climb(k) { blendPose(P, standP, sitP, Math.min(1, k * 1.15)); const lift = Math.sin(Math.min(1, k * 1.4) * Math.PI); P[17] += lift * 0.9; P[19] += lift * 1.2; P[0] = standP[0] + (sitP[0] - standP[0]) * Math.min(1, k * 1.2); fig.apply(); },
    sit(t = 0) { P.set(sitP); P[7] = 0.15 * Math.sin(t * 0.35); P[8] += 0.05 * Math.sin(t * 0.5); fig.apply(); },
    seatHipY,
    dispose() { for (const o of own) o.dispose && o.dispose(); if (sheer) { sheer.geo.dispose(); sheer.mat.dispose(); } fig.dispose(); group.parent && group.parent.remove(group); },
  };
}
