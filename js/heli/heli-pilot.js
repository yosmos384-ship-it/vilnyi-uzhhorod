// heli-pilot.js — V27: the pilot of the helicopter view. A detailed, rigged 3-D character (assets/heli/pilot-hi.glb, phones
// pilot-lo.glb; built in Blender from the CC0 MakeHuman / MPFB2 base mesh — build scripts and brief in the private project).
// Professional behaviour only; lives only inside the lazy-loaded helicopter mode. Animation is procedural on the glTF
// skeleton (game-engine rig, 53 bones): walk cycle, door reach, invite gesture, climb in, seated flying with two-bone IK —
// hands on the cyclic / collective grips and feet on the pedals follow the cockpit controls — small head turns towards
// the client, breathing and blinking. If the model cannot be loaded the V26 figure (heli-pilot-basic.js) is used — same API.
import * as THREE from 'three';

const DRACO_PATH = new URL('../../vendor/addons/libs/draco/gltf/', import.meta.url).href;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

/** skin: physically based + a cheap wrapped, warm diffuse term (light bleeding through the skin at the terminator) */
function skinPatch(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
      void RE_Direct_Skin( const in IncidentLight directLight, const in vec3 geometryNormal ) {}
    `.replace('void RE_Direct_Skin( const in IncidentLight directLight, const in vec3 geometryNormal ) {}', '')).replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      #if NUM_DIR_LIGHTS > 0
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
        float w = dot( normal, directionalLights[ i ].direction );
        float wrap = clamp( ( w + 0.5 ) / 1.5, 0.0, 1.0 ) - clamp( w, 0.0, 1.0 );
        reflectedLight.directDiffuse += directionalLights[ i ].color * vec3( 0.32, 0.12, 0.08 ) * max( wrap, 0.0 ) * BRDF_Lambert( material.diffuseColor );
      }
      #endif
    `);
  };
  mat.customProgramCacheKey = () => 'vrc-pilot-skin';
}

function makeMaterials(src, phone, aa) {
  const tex = (m) => m || null;
  const P = (o) => new THREE.MeshPhysicalMaterial(o), S = (o) => new THREE.MeshStandardMaterial(o);
  const name = src.name || '';
  if (name === 'pilot-skin') {
    const m = P({ map: tex(src.map), roughnessMap: tex(src.roughnessMap), roughness: 1, metalness: 0, sheen: 0.35, sheenColor: new THREE.Color('#ffc3b0'), sheenRoughness: 0.55,
      clearcoat: phone ? 0 : 0.08, clearcoatRoughness: 0.45, specularIntensity: 0.55 });
    skinPatch(m); return m;
  }
  if (name === 'pilot-hair') return P({ map: tex(src.map), alphaTest: 0.38, alphaToCoverage: !!aa, side: THREE.DoubleSide, roughness: 0.48, metalness: 0,
    sheen: 0.55, sheenColor: new THREE.Color('#e8cf9a'), sheenRoughness: 0.35, specularIntensity: 0.5, specularColor: new THREE.Color('#ffe6b8') });
  if (name === 'pilot-hairshell') {
    const m = src.map; if (m) { m.wrapS = THREE.RepeatWrapping; m.anisotropy = 4; }
    return P({ map: m || null, alphaTest: 0.42, alphaToCoverage: !!aa, side: THREE.DoubleSide, roughness: 0.5, metalness: 0,
      sheen: 0.5, sheenColor: new THREE.Color('#e8cf9a'), sheenRoughness: 0.38, specularIntensity: 0.5, specularColor: new THREE.Color('#ffe6b8') });
  }
  if (name === 'pilot-eye') return P({ map: tex(src.map), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 });
  if (name === 'pilot-top') {
    const n = src.normalMap; if (n) { n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(26, 26); }
    return P({ vertexColors: true, roughness: 0.82, normalMap: n || null, normalScale: new THREE.Vector2(0.35, 0.35), sheen: 0.7, sheenColor: new THREE.Color('#7f93bf'), sheenRoughness: 0.6, side: THREE.DoubleSide });
  }
  if (name === 'pilot-shorts') {
    const n = src.normalMap; if (n) { n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(34, 34); }
    return P({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.72, normalMap: n || null, normalScale: new THREE.Vector2(0.25, 0.25), sheen: 0.6, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.5 });
  }
  if (name === 'pilot-briefs') return S({ vertexColors: true, roughness: 0.62 });
  if (name === 'pilot-boots') return P({ vertexColors: true, roughness: 0.38, clearcoat: phone ? 0 : 0.55, clearcoatRoughness: 0.28 });
  if (name === 'pilot-gear') return S({ vertexColors: true, roughness: 0.42, metalness: 0.05 });
  if (name === 'pilot-frame') return S({ color: '#b39463', roughness: 0.25, metalness: 1 });
  if (name === 'pilot-lens') return P({ color: '#0a0c10', roughness: 0.04, metalness: 0.4, transparent: true, opacity: 0.9, side: THREE.DoubleSide, iridescence: phone ? 0 : 0.35, iridescenceIOR: 1.6, envMapIntensity: 1.6 });
  return src;
}

async function loadModel(phone, aa) {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js')]);
  const draco = new DRACOLoader(); draco.setDecoderPath(DRACO_PATH);
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const url = new URL(`../../assets/heli/pilot-${phone ? 'lo' : 'hi'}.glb`, import.meta.url).href;
  try { return await loader.loadAsync(url); } finally { draco.dispose(); }
}

/** the rig: rest data, semantic rotations in model axes (x right→her left, y up, z forward), two-bone IK */
function makeRig(root, skeleton) {
  const B = {}; for (const b of skeleton.bones) B[b.name] = b;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rest = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = V(), _s = V();
  for (const b of skeleton.bones) {
    _m.multiplyMatrices(rootInv, b.matrixWorld); _m.decompose(_p, _q, _s);
    rest.set(b, { q: b.quaternion.clone(), p: b.position.clone(), W: _q.clone(), Wi: _q.clone().invert(), pos: _p.clone() });
  }
  const len = (a, b) => rest.get(B[a]).pos.distanceTo(rest.get(B[b]).pos);
  const L = { arm1: len('upperarm_l', 'lowerarm_l'), arm2: len('lowerarm_l', 'hand_l'), leg1: len('thigh_l', 'calf_l'), leg2: len('calf_l', 'foot_l') };
  const acc = new Map();   // bone → accumulated model-space rotation (applied in rest frame)
  const tq = new THREE.Quaternion(), te = new THREE.Euler();
  function reset() { acc.clear(); for (const b of skeleton.bones) { const r = rest.get(b); b.quaternion.copy(r.q); b.position.copy(r.p); } }
  /** add a rotation (Euler x, y, z in model axes, order YXZ) to a bone */
  function rot(name, x = 0, y = 0, z = 0) {
    const b = B[name]; if (!b) return; te.set(x, y, z, 'YXZ'); tq.setFromEuler(te);
    const a = acc.get(b) || new THREE.Quaternion(); a.premultiply(tq); acc.set(b, a);
  }
  function rotAxis(name, axis, ang) { const b = B[name]; if (!b) return; tq.setFromAxisAngle(axis, ang); const a = acc.get(b) || new THREE.Quaternion(); a.premultiply(tq); acc.set(b, a); }
  function apply() {
    for (const [b, a] of acc) { const r = rest.get(b); b.quaternion.copy(r.W).premultiply(a).premultiply(r.Wi).premultiply(r.q); }
    // ^ q_local = q_rest · (W⁻¹ · A · W)
  }
  const mq = new THREE.Quaternion(), pq = new THREE.Quaternion(), wp = V(), wc = V();
  const modelPos = (b, out) => out.setFromMatrixPosition(_m.multiplyMatrices(rootInv, b.matrixWorld));
  const modelQuat = (o, out) => { _m.multiplyMatrices(rootInv, o.matrixWorld); _m.decompose(_p, out, _s); return out; };
  function refresh() { root.updateWorldMatrix(true, true); rootInv.copy(root.matrixWorld).invert(); }
  /** rotate bone so that the direction to its child joint points at the model-space target */
  function aim(b, child, target) {
    modelPos(b, wp); modelPos(child, wc);
    const v0 = wc.sub(wp).normalize(), v1 = target.clone().sub(wp).normalize();
    const dq = new THREE.Quaternion().setFromUnitVectors(v0, v1);
    modelQuat(b, mq).premultiply(dq);
    modelQuat(b.parent, pq); b.quaternion.copy(pq.invert().multiply(mq)); b.updateMatrixWorld(true);
  }
  /** analytic two-bone IK: a → b → c reaching target t (model space), knee / elbow towards pole */
  function ik(a, b, c, t, pole, l1, l2) {
    refresh();
    const A = modelPos(B[a], V()), d = t.clone().sub(A); let dist = d.length();
    dist = clamp(dist, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3); const dir = d.normalize();
    const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const pp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = A.clone().addScaledVector(dir, x).addScaledVector(pp, h);
    aim(B[a], B[b], E); aim(B[b], B[c], A.clone().addScaledVector(dir, dist));
  }
  // finger curl axes per hand (rest pose): curl moves the finger towards the palm
  const curlAxis = {}, handRest = {};
  for (const s of ['l', 'r']) {
    const h = rest.get(B['hand_' + s]).pos, mid = rest.get(B['middle_01_' + s]).pos, idx = rest.get(B['index_01_' + s]).pos, pk = rest.get(B['pinky_01_' + s]).pos;
    const a = mid.clone().sub(h).normalize(), across = idx.clone().sub(pk).normalize();
    let n = a.clone().cross(across).normalize(); if (s === 'r') n.negate();          // palm normal (mirrored for the right hand)
    curlAxis[s] = a.clone().cross(n).normalize(); handRest[s] = { a, n };
  }
  /** orient a hand in model space: fingers along aW, palm facing nW (both model-space directions) */
  const _m3a = new THREE.Matrix4(), _m3b = new THREE.Matrix4();
  function orientHand(s, aW, nW) {
    const b = B['hand_' + s], r = rest.get(b), hr = handRest[s];
    const a1 = aW.clone().normalize(), n1 = nW.clone().sub(a1.clone().multiplyScalar(nW.dot(a1))).normalize(), c1 = a1.clone().cross(n1);
    const c0 = hr.a.clone().cross(hr.n);
    _m3a.makeBasis(hr.a, hr.n, c0); _m3b.makeBasis(a1, n1, c1);
    const D = new THREE.Quaternion().setFromRotationMatrix(_m3b.multiply(_m3a.transpose()));
    refresh(); const Q = D.multiply(r.W); modelQuat(b.parent, pq); b.quaternion.copy(pq.invert().multiply(Q)); b.updateMatrixWorld(true);
  }
  function curl(s, k, thumb = 0.5) {
    for (const f of ['index', 'middle', 'ring', 'pinky']) for (const j of ['01', '02', '03']) rotAxis(`${f}_${j}_${s}`, curlAxis[s], k * (j === '01' ? 0.75 : 1.0));
    for (const j of ['02', '03']) rotAxis(`thumb_${j}_${s}`, curlAxis[s], thumb * 0.6);
  }
  return { B, rest, L, reset, rot, rotAxis, apply, ik, refresh, curl, modelPos, aim, orientHand };
}

export async function createPilot(opts = {}) {
  const phone = !!opts.phone;
  let gltf;
  try { gltf = await loadModel(phone, opts.antialias); }
  catch (e) {
    console.warn('[heli] pilot model unavailable — basic figure', e);
    const M = await import('./heli-pilot-basic.js'); return M.createBasicPilot();
  }
  const group = new THREE.Group(); group.name = 'heli-pilot';
  const root = gltf.scene; root.name = 'pilot-model'; group.add(root);
  const own = []; let skeleton = null, body = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
    const nm = makeMaterials(o.material, phone, opts.antialias); if (nm !== o.material) { nm.name = o.material.name; own.push(o.material); o.material = nm; }
    own.push(o.material, o.geometry);
    if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton;
    if (/^Body/.test(o.name) || o.material.name === 'pilot-skin' || (o.morphTargetInfluences && o.morphTargetInfluences.length)) body = body || (o.morphTargetInfluences ? o : null);
    if (o.material.transparent) o.renderOrder = 2;
  });
  const R = makeRig(root, skeleton);
  const hipY = R.rest.get(R.B.thigh_l).pos.y;      // hip joints above the soles (standing)
  const st = { t: 0, blinkT: 2.5, blink: 0, look: 0, lookT: 6, lookHold: 0, breath: 0, mode: 'stand', cockpit: null, ctl: { fwd: 0, lat: 0, col: 0, ped: 0 } };
  const SEAT_UP = 0.1, SEAT_BACK = -0.08;          // hip joints above the seat cushion / behind the seat anchor

  // ---- poses (model-axis angles; x = pitch: negative swings a hanging limb forward)
  function base(armsDown = 0.62) {
    R.reset();
    R.rot('upperarm_l', 0, 0, -armsDown); R.rot('upperarm_r', 0, 0, armsDown);
    R.rot('lowerarm_l', -0.06, 0, 0); R.rot('lowerarm_r', -0.06, 0, 0);
    R.curl('l', 0.25, 0.2); R.curl('r', 0.25, 0.2);
  }
  function idle(t) {   // breathing, weight shift, small head motion
    const b = Math.sin(t * 1.6) * 0.012;
    R.rot('spine_02', -b, 0, 0); R.rot('spine_03', -b * 0.8, 0, 0); R.rot('clavicle_l', 0, 0, b * 0.6); R.rot('clavicle_r', 0, 0, -b * 0.6);
  }
  function headLook(yaw, pitch = 0) { R.rot('neck_01', pitch * 0.4, yaw * 0.4, 0); R.rot('head', pitch * 0.6, yaw * 0.6, 0); }
  function blinkTick(dt) {
    st.blinkT -= dt; if (st.blinkT <= 0) { st.blink = 0.16; st.blinkT = 2.4 + Math.random() * 3.6; }
    if (st.blink > 0) st.blink = Math.max(0, st.blink - dt);
    if (body) body.morphTargetInfluences[0] = st.blink > 0 ? Math.sin((1 - st.blink / 0.16) * Math.PI) : 0;
  }
  let lastT = performance.now() / 1000;
  const dtNow = () => { const n = performance.now() / 1000, d = clamp(n - lastT, 0, 0.1); lastT = n; st.t += d; return d; };
  const setRoot = (y = 0, z = 0) => { root.position.set(0, y, z); };

  function walk(phase, amp = 1) {
    const dt = dtNow(); st.mode = 'walk'; base(0.68);
    const s = Math.sin(phase), c = Math.cos(phase), A = 0.42 * amp;
    R.rot('thigh_l', -A * s, 0, 0); R.rot('thigh_r', A * s, 0, 0);
    const kneeL = 0.12 + 0.75 * Math.max(0, c) ** 1.4, kneeR = 0.12 + 0.75 * Math.max(0, -c) ** 1.4;
    R.rot('calf_l', kneeL * amp, 0, 0); R.rot('calf_r', kneeR * amp, 0, 0);
    R.rot('foot_l', (A * s - kneeL * 0.55) * 0.6, 0, 0); R.rot('foot_r', (-A * s - kneeR * 0.55) * 0.6, 0, 0);
    R.rot('pelvis', 0, 0.07 * s * amp, 0.025 * c * amp); R.rot('spine_02', 0.03, -0.05 * s * amp, 0); R.rot('spine_03', 0, -0.04 * s * amp, -0.02 * c * amp);
    R.rot('upperarm_l', 0.32 * s * amp, 0, 0); R.rot('upperarm_r', -0.32 * s * amp, 0, 0);
    R.rot('lowerarm_l', -0.04 - 0.14 * Math.max(0, -s) * amp, 0, 0); R.rot('lowerarm_r', -0.04 - 0.14 * Math.max(0, s) * amp, 0, 0);
    headLook(0.04 * s, 0.03);
    idle(st.t); R.apply(); blinkTick(dt);
    setRoot(-0.012 + 0.012 * Math.cos(2 * phase) * amp, 0);
  }
  function stand() { const dt = dtNow(); st.mode = 'stand'; base(); idle(st.t); headLook(0, 0.02); R.apply(); blinkTick(dt); setRoot(0, 0); }
  /** reach for a door handle (k 0..1): right arm forward and up, a small lean */
  function reach(k) {
    const dt = dtNow(); st.mode = 'reach'; base(); idle(st.t);
    R.rot('spine_02', -0.06 * k, 0, 0); R.rot('spine_03', 0, -0.12 * k, 0);
    R.rot('upperarm_r', -1.15 * k, 0.1 * k, 0.35 * k); R.rot('lowerarm_r', -0.35 * k, 0, 0); R.curl('r', 0.55 * k, 0.4 * k);
    headLook(-0.1 * k, 0.12 * k); R.apply(); blinkTick(dt); setRoot(0, 0);
  }
  /** inviting gesture (k 0..1): open palm towards the door, a slight turn and nod towards the client */
  function invite(k) {
    const dt = dtNow(); st.mode = 'invite'; base(); idle(st.t);
    R.rot('spine_03', 0, 0.12 * k, 0);
    R.rot('upperarm_l', -0.75 * k, 0.35 * k, 0.5 * k); R.rot('lowerarm_l', -0.45 * k, 0.3 * k, 0); R.rot('hand_l', 0, 0.5 * k, -0.4 * k); R.curl('l', -0.05 * k, 0);
    headLook(0.08 * k, 0.1 * k * (0.6 + 0.4 * Math.sin(st.t * 2))); R.apply(); blinkTick(dt); setRoot(0, 0);
  }
  function sitPose(t, lookYaw = 0) {
    base(0.3);
    R.rot('thigh_l', -1.42, 0, 0.08); R.rot('thigh_r', -1.42, 0, -0.08);
    R.rot('calf_l', 1.25, 0, 0); R.rot('calf_r', 1.25, 0, 0);
    R.rot('spine_01', 0.1, 0, 0); R.rot('spine_02', 0.03, 0, 0); R.rot('neck_01', -0.08, 0, 0);
    idle(t); headLook(lookYaw, 0.02);
  }
  /** climbing in: k 0..1 from standing at the door to seated; knee lift in the middle */
  function climb(k) {
    const dt = dtNow(); st.mode = 'climb';
    const ks = sm(0.4, 1, k), lift = Math.sin(clamp(k / 0.5, 0, 1) * Math.PI);
    base(lerp(0.62, 0.3, ks));
    R.rot('thigh_l', -1.42 * ks - 0.9 * lift, 0, 0.08 * ks); R.rot('thigh_r', -1.42 * ks, 0, -0.08 * ks);
    R.rot('calf_l', 1.25 * ks + 1.1 * lift, 0, 0); R.rot('calf_r', 1.25 * ks + 0.2 * lift, 0, 0);
    R.rot('spine_02', -0.18 * lift, 0, 0); R.rot('upperarm_r', -0.9 * lift, 0, 0.3 * lift); R.rot('lowerarm_r', -0.6 * lift, 0, 0);
    R.rot('upperarm_l', -0.6 * lift, 0, -0.2 * lift); R.curl('r', 0.7 * lift, 0.5);
    idle(st.t); headLook(0, -0.1 * lift); R.apply(); blinkTick(dt);
    setRoot(lerp(0, SEAT_UP - hipY, ks), lerp(0, SEAT_BACK, ks));
  }
  const _t = V(), _wp = V();
  function target(obj, out) { obj.getWorldPosition(_wp); root.worldToLocal(out.copy(_wp)); return out; }
  /** seated (cut-scene end, parked): hands on the thighs / grips, feet on the pedals */
  function sit(t = 0) { fly(t, null); }
  /** seated and flying: hands and feet follow the controls; small head turns towards the client (on her left) */
  function fly(t, ctl, dtIn) {
    const dt = dtIn != null ? dtIn : dtNow(); if (dtIn != null) { st.t += dt; lastT = performance.now() / 1000; }
    st.mode = 'fly';
    // phones: the seated pose and the IK are refreshed at half rate (the controls move slowly); blink / look keep their time
    if (phone && (st.half = !st.half) && st.flyInit) { st.t += 0; blinkTick(dt); return; }
    st.flyInit = true;
    // look at the client now and then (and when the visitor looks at her: opts.lookAtClient)
    st.lookT -= dt;
    if (st.lookT <= 0) { st.lookHold = 1.4 + Math.random() * 1.2; st.lookT = 9 + Math.random() * 9; }
    if (st.lookHold > 0) st.lookHold -= dt;
    const want = st.lookHold > 0 || st.forceLook ? 0.62 : 0;
    st.look += (want - st.look) * Math.min(1, dt * 3.2);
    setRoot(SEAT_UP - hipY, SEAT_BACK);
    sitPose(st.t, st.look);
    const C = st.cockpit;
    if (C) { R.curl('r', 0.75, 0.6); R.curl('l', 0.7, 0.5); }      // fingers round the grips (added to the relaxed curl)
    R.apply();
    if (C) {
      // wrist a little behind / beside the grip so the closed fingers wrap round it
      if (C.stickGrip) { R.ik('upperarm_r', 'lowerarm_r', 'hand_r', target(C.stickGrip, _t).add(V(-0.045, -0.035, -0.06)), V(-0.9, -0.6, -0.5), R.L.arm1, R.L.arm2); R.orientHand('r', V(0.35, -0.15, 1), V(1, 0, -0.3)); }
      if (C.collGrip) { R.ik('upperarm_l', 'lowerarm_l', 'hand_l', target(C.collGrip, _t).add(V(0.02, 0.03, -0.07)), V(0.9, -0.6, -0.4), R.L.arm1, R.L.arm2); R.orientHand('l', V(-0.25, -0.3, 1), V(-0.2, -1, 0)); }
      const PD = V(0, 0.68, 0.73), PN = V(0, 0.73, -0.68);
      for (const [s, pad] of [['l', C.pedalL], ['r', C.pedalR]]) {
        if (!pad) continue;
        const P0 = target(pad, V()), ank = P0.clone().addScaledVector(PD, -0.1).addScaledVector(PN, 0.075);
        R.ik('thigh_' + s, 'calf_' + s, 'foot_' + s, ank, V(s === 'l' ? 0.2 : -0.2, 1, 0.7), R.L.leg1, R.L.leg2);
        R.refresh(); R.aim(R.B['foot_' + s], R.B['ball_' + s], P0.clone().addScaledVector(PD, 0.04).addScaledVector(PN, 0.03));
      }
    }
    blinkTick(dt);
  }
  return {
    group, R, detailed: true,
    walk, stand, reach, invite, climb, sit, fly,
    /** the app places the group at seatHipY(seatTop): the group origin is the seat cushion top */
    seatHipY: (seatY) => seatY,
    /** cockpit anchors (Object3D grips / pedal pads from heli-model controls) */
    setCockpit(c) { st.cockpit = c; },
    lookAtClient(on) { st.forceLook = !!on; },
    get triangles() { let n = 0; root.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; },
    dispose() {
      const tx = new Set(); for (const o of own) if (o && o.isMaterial) for (const k of ['map', 'roughnessMap', 'normalMap']) if (o[k]) tx.add(o[k]);
      for (const t of tx) t.dispose(); for (const o of own) o && o.dispose && o.dispose(); group.parent && group.parent.remove(group);
    },
  };
}
