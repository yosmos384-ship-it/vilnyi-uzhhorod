// google3d.js — Google Photorealistic 3D Tiles (Map Tiles API) as the city of the 3D worlds, OFF until a key is set.
// Shared by the VILNYI sales sites (same file in vilnyi-river-city and vilnyi-uzhhorod); each world passes its own adapter.
// Library: NASA-AMMOS 3DTilesRendererJS 0.3.46 (vendor/3d-tiles-renderer, MIT, imports rewritten to three/addons/) on three r160.
//
//   google3dConfigured() → true when js/maps-config.js has GOOGLE_3D_KEY (no network, no side effects on import)
//   attachGoogle3D(THREE, o) → ctl            (nothing is downloaded until ctl.enter())
//     o.frame      { toLL(x, z) → [latDeg, lonDeg], fromLL(latDeg, lonDeg) → [x, z], h0 }  the world's geo frame (any rotation /
//                  scale: the local east / south axes are measured from it by finite differences); h0 = WGS84 ellipsoid
//                  height of world y = 0 (a first guess: the vertical lock below measures the true offset on the roads)
//     o.parent     Object3D the tiles are added to (scene or a group of the world)
//     o.renderer, o.host (HTMLElement for the logo / note / toggle), o.lang, o.id ('drive' | 'walk': remembered choice)
//     o.hideClassic(on)        hide / show the world's own (OpenStreetMap / procedural) city — Google policy: no other map data
//     o.refPoints(x, z) → [[x, z]…]   road points near (x, z) whose surface is world y = 0 (vertical lock)
//     o.clip       [{ x, z, ux, uz, hw, hd, top }]  world boxes where Google's mesh is cut away (the project's own plot)
//     o.mountButton(btn) → bool   optional: the site puts the 🌍/🗺 toggle in its own HUD (else it goes with the logo)
//     o.tint() → 0…1               optional: brightness of the (unlit, daylight) photo tiles — dusk / night
//     o.say(text, ms), o.onMode(ctl), o.cls (extra class on the overlay for site CSS), o.visible() → bool (world on screen)
//   ctl.enter() / update(camera, dt) / exit() / dispose() / setMode('google' | 'classic') / stats()
//   ctl.mode (wanted) · ctl.active (Google on screen, classic hidden) · ctl.status idle|loading|ok|failed|off · ctl.reason
//
// Map Tiles API policies (developers.google.com/maps/documentation/tile/policies), as in the yosmosllc V14 helicopter world:
//  • the Google Maps logo (official asset, 16 px, clear space) + the data attributions of the tiles in view, on one line
//    (tap → "Data sources"); the hybrid scene is labelled (city: Google; project, car, people, labels: ours);
//  • tiles are streamed live from the root session; nothing is pre-fetched, stored or cached by this code (the browser HTTP
//    cache follows the API's Cache-Control headers); GoogleCloudAuthPlugin renews the session;
//  • no mixing with other map data: while Google is shown the world hides its own OSM / procedural city (hideClassic);
//  • EEA: a key of a Cloud billing account with an EEA billing address gets 403 "…not available for your account and
//    region" → the classic world comes back with a short note, as for 401/403/429, offline, no tiles, no 3D coverage.
// The key is never logged: Google's error text is shown with key=… masked.
import { GOOGLE_3D_KEY, GOOGLE_3D_MIN_DETAIL_M } from '../maps-config.js';

const ROOT_HOST = 'tile.googleapis.com';
const START_TIMEOUT = 22000;        // no tile at all after this → classic
const COVER_WAIT = 9000;            // after the first tile: settle time before the 3D-coverage check
const LS = 'vrc.g3d.';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lsGet = (k) => { try { return localStorage.getItem(LS + k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, v); } catch (_) { /* private mode */ } };
const testKey = () => { try { return typeof window !== 'undefined' && typeof window.__VRC_G3D_KEY === 'string' ? window.__VRC_G3D_KEY : null; } catch (_) { return null; } };
const key = () => { const t = testKey(); return t != null ? t : (typeof GOOGLE_3D_KEY === 'string' ? GOOGLE_3D_KEY.trim() : ''); };
function isPhone() { try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820; } catch (_) { return false; } }

export function google3dConfigured() { return !!key(); }

/* ------------------------------------------------------------------------------------------- strings (8 site languages) */
const STR = {
  en: { on: 'Google 3D', off: 'Classic', aria: 'City view: Google 3D or the classic map', loading: 'Loading Google 3D…', onMsg: 'Google 3D city', offMsg: 'Classic map',
    fail: 'Google 3D isn’t available right now — showing the classic map', noCov: 'No Google 3D coverage here — showing the classic map', data: 'Data sources',
    hybrid: '3D city: Google Maps · project, car, people and labels: VILNYI', own: 'City: Google · project & car: VILNYI', osm: 'Street network for driving (not shown): © OpenStreetMap contributors' },
  he: { on: 'Google 3D', off: 'קלאסי', aria: 'תצוגת העיר: Google 3D או המפה הקלאסית', loading: 'טוען Google 3D…', onMsg: 'העיר ב‑Google 3D', offMsg: 'מפה קלאסית',
    fail: 'Google 3D אינו זמין כרגע — מוצגת המפה הקלאסית', noCov: 'אין כיסוי Google 3D באזור — מוצגת המפה הקלאסית', data: 'מקורות הנתונים',
    hybrid: 'העיר בתלת‑ממד: Google Maps · הפרויקט, הרכב, האנשים והתוויות: VILNYI', own: 'העיר: Google · הפרויקט והרכב: VILNYI', osm: 'רשת הרחובות לנהיגה (לא מוצגת): © OpenStreetMap contributors' },
  ro: { on: 'Google 3D', off: 'Clasic', aria: 'Vederea orașului: Google 3D sau harta clasică', loading: 'Se încarcă Google 3D…', onMsg: 'Orașul Google 3D', offMsg: 'Harta clasică',
    fail: 'Google 3D nu este disponibil acum — se afișează harta clasică', noCov: 'Nu există acoperire Google 3D aici — se afișează harta clasică', data: 'Surse de date',
    hybrid: 'Orașul 3D: Google Maps · proiectul, mașina, oamenii și etichetele: VILNYI', own: 'Oraș: Google · proiect și mașină: VILNYI', osm: 'Rețeaua de străzi pentru condus (neafișată): © OpenStreetMap contributors' },
  ru: { on: 'Google 3D', off: 'Классика', aria: 'Вид города: Google 3D или классическая карта', loading: 'Загружается Google 3D…', onMsg: 'Город Google 3D', offMsg: 'Классическая карта',
    fail: 'Google 3D сейчас недоступен — показана классическая карта', noCov: 'Здесь нет покрытия Google 3D — показана классическая карта', data: 'Источники данных',
    hybrid: '3D‑город: Google Maps · проект, машина, люди и подписи: VILNYI', own: 'Город: Google · проект и машина: VILNYI', osm: 'Сеть улиц для вождения (не показана): © OpenStreetMap contributors' },
  uk: { on: 'Google 3D', off: 'Класика', aria: 'Вигляд міста: Google 3D або класична мапа', loading: 'Завантажується Google 3D…', onMsg: 'Місто Google 3D', offMsg: 'Класична мапа',
    fail: 'Google 3D зараз недоступний — показано класичну мапу', noCov: 'Тут немає покриття Google 3D — показано класичну мапу', data: 'Джерела даних',
    hybrid: '3D‑місто: Google Maps · проєкт, авто, люди й підписи: VILNYI', own: 'Місто: Google · проєкт і авто: VILNYI', osm: 'Мережа вулиць для їзди (не показана): © OpenStreetMap contributors' },
  fr: { on: 'Google 3D', off: 'Classique', aria: 'Vue de la ville : Google 3D ou carte classique', loading: 'Chargement de Google 3D…', onMsg: 'Ville Google 3D', offMsg: 'Carte classique',
    fail: 'Google 3D n’est pas disponible pour le moment — carte classique affichée', noCov: 'Pas de couverture Google 3D ici — carte classique affichée', data: 'Sources des données',
    hybrid: 'Ville 3D : Google Maps · projet, voiture, personnes et étiquettes : VILNYI', own: 'Ville : Google · projet et voiture : VILNYI', osm: 'Réseau de rues pour la conduite (non affiché) : © OpenStreetMap contributors' },
  it: { on: 'Google 3D', off: 'Classica', aria: 'Vista della città: Google 3D o mappa classica', loading: 'Caricamento di Google 3D…', onMsg: 'Città Google 3D', offMsg: 'Mappa classica',
    fail: 'Google 3D non è disponibile ora — mostrata la mappa classica', noCov: 'Nessuna copertura Google 3D qui — mostrata la mappa classica', data: 'Fonti dei dati',
    hybrid: 'Città 3D: Google Maps · progetto, auto, persone ed etichette: VILNYI', own: 'Città: Google · progetto e auto: VILNYI', osm: 'Rete stradale per la guida (non mostrata): © OpenStreetMap contributors' },
  de: { on: 'Google 3D', off: 'Klassisch', aria: 'Stadtansicht: Google 3D oder klassische Karte', loading: 'Google 3D wird geladen…', onMsg: 'Google‑3D‑Stadt', offMsg: 'Klassische Karte',
    fail: 'Google 3D ist gerade nicht verfügbar — klassische Karte', noCov: 'Hier gibt es keine Google‑3D‑Abdeckung — klassische Karte', data: 'Datenquellen',
    hybrid: '3D‑Stadt: Google Maps · Projekt, Auto, Personen und Beschriftungen: VILNYI', own: 'Stadt: Google · Projekt & Auto: VILNYI', osm: 'Straßennetz zum Fahren (nicht angezeigt): © OpenStreetMap contributors' },
};
export function g3dStrings(lang) { const l = String(lang || (typeof document !== 'undefined' && document.documentElement.lang) || 'en').slice(0, 2).toLowerCase(); return STR[l] || STR.en; }

/* ------------------------------------------------------------------------------------------- overlay CSS (sites add placement rules) */
const CSS = `
.g3d-wrap{position:absolute;z-index:7;display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;direction:ltr;font-family:Roboto,Arial,system-ui,sans-serif;max-width:min(76vw,560px)}
.g3d-wrap .g3d-box{display:none;flex-direction:column;align-items:center;gap:1px}
.g3d-wrap.on .g3d-box{display:flex}
.g3d-wrap .g3d-row{display:flex;align-items:flex-end;gap:10px;pointer-events:auto;cursor:pointer;padding:6px 10px 3px 10px;max-width:100%}
.g3d-wrap .g3d-logo{height:16px;width:auto;flex:0 0 auto;display:block}
.g3d-wrap .g3d-data{font-size:10.5px;line-height:13px;color:#fff;text-shadow:0 0 2px #000,0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.g3d-wrap .g3d-own{font-size:9.5px;line-height:12px;color:rgba(255,255,255,.9);text-shadow:0 0 2px #000,0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.g3d-wrap .g3d-pop{display:none;pointer-events:auto;max-width:min(86vw,420px);margin-top:4px;padding:10px 12px;border-radius:10px;background:rgba(12,14,18,.94);color:#eef1f4;font-size:12px;line-height:1.45;box-shadow:0 6px 20px rgba(0,0,0,.45);text-align:start;unicode-bidi:plaintext}
.g3d-wrap .g3d-pop b{display:block;font-size:12.5px;margin-bottom:3px}.g3d-wrap .g3d-pop p{margin:0 0 6px}
.g3d-wrap.open .g3d-pop{display:block}
.g3d-btn{pointer-events:auto;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border-radius:14px;border:1px solid rgba(226,192,120,.55);background:rgba(10,10,12,.62);color:#f3efe6;font:600 11.5px/1 Manrope,Heebo,Roboto,Arial,system-ui,sans-serif;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}
.g3d-btn.on{background:linear-gradient(180deg,#f0d596,#b88a3c);color:#14100a;border-color:#f0d596}
.g3d-btn.busy .i{display:inline-block;animation:g3dspin 1.2s linear infinite}@keyframes g3dspin{to{transform:rotate(360deg)}}
.g3d-note{position:absolute;z-index:8;left:50%;top:42%;transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:rgba(12,14,18,.82);color:#fff;font:600 12px/1.3 Manrope,Heebo,Roboto,Arial,system-ui,sans-serif;max-width:calc(100% - 32px);text-align:center;pointer-events:none;opacity:0;transition:opacity .4s;unicode-bidi:plaintext}
.g3d-note.show{opacity:1}
`;

/* ------------------------------------------------------------------------------------------- controller */
export function attachGoogle3D(THREE, o = {}) {
  const S = g3dStrings(o.lang), id = o.id || 'world';
  // a status message: the world's own toast when it has one, else the module's note pill (never both)
  const say = (t, ms) => { if (!o.say) return note(t, ms); try { o.say(t, ms); } catch (_) { /* */ } };
  const phone = o.quality === 'low' || isPhone();
  const hasDom = typeof document !== 'undefined';
  const minDetail = isFinite(+GOOGLE_3D_MIN_DETAIL_M) && +GOOGLE_3D_MIN_DETAIL_M > 0 ? +GOOGLE_3D_MIN_DETAIL_M : 6;
  const FR = o.frame, H0 = isFinite(FR.h0) ? FR.h0 : 100;

  // wrapper (the world may hide it, e.g. a culled car park) → holder (this module: Google on / off) → tiles.group
  const wrap = new THREE.Group(); wrap.name = 'g3d-wrap';
  const holder = new THREE.Group(); holder.name = 'g3d-tiles'; holder.matrixAutoUpdate = false; holder.visible = false; wrap.add(holder);
  // the project's plot: Google's mesh is cut away there; a plain pad of ours fills what the world's plot mesh leaves open
  const clipBoxes = (o.clip || []).filter((c) => c && isFinite(c.x) && isFinite(c.z)).slice(0, 4);
  const CLIP = { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, CLIPN = { value: clipBoxes.length };
  clipBoxes.forEach((c, i) => { const l = Math.hypot(c.ux, c.uz) || 1; CLIP.value[2 * i].set(c.x, c.z, c.ux / l, c.uz / l); CLIP.value[2 * i + 1].set(c.hw, c.hd, c.top != null ? c.top : 600, 0); });
  let pad = null;
  if (clipBoxes.length && o.clipFill !== false) {
    pad = new THREE.Group(); pad.name = 'g3d-plot-pad';
    const pm = new THREE.MeshLambertMaterial({ color: o.padColor || '#7c7a74' });
    for (const c of clipBoxes) { const l = Math.hypot(c.ux, c.uz) || 1, m = new THREE.Mesh(new THREE.PlaneGeometry(c.hw * 2, c.hd * 2).rotateX(-Math.PI / 2), pm); m.position.set(c.x, o.padY != null ? o.padY : -0.03, c.z); m.rotation.y = Math.atan2(-c.uz / l, c.ux / l); m.receiveShadow = true; pad.add(m); }
    pad.visible = false; wrap.add(pad);
  }
  if (o.parent) o.parent.add(wrap);

  const saved = lsGet(id);
  const ctl = {
    mode: google3dConfigured() && saved !== 'classic' ? 'google' : 'classic',
    active: false, status: google3dConfigured() ? 'idle' : 'off', reason: '', entered: false, disposed: false,
  };
  let lib = null, libP = null, tiles = null, auth = null, draco = null, t0 = 0, models = 0, lastOk = 0, failedSeen = 0, firstAt = 0, covChecked = false;
  let anchor = null, dy = 0, dyTarget = null, lockT = 0, attrT = 0, resT = 0, btnT = 0, attrText = '', tintNow = 1, locked = false, frames = 0, firstFrame = 0;
  const jobs = [];   // the download / parse queues run from update() (the world's own frame), not from extra rAF callbacks
  const camP = new THREE.Vector3(), v3 = new THREE.Vector3(), m4 = new THREE.Matrix4(), RY = new THREE.Matrix4().makeRotationY(Math.PI), size = new THREE.Vector2(), DOWN = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;

  /* ---- DOM: [toggle] + logo + attributions + hybrid line + data-sources panel; centred note */
  let wrapEl = null, dataEl = null, popEl = null, noteEl = null, noteT = 0, btn = null, btnOwn = false;
  const host = () => o.host || (o.renderer && o.renderer.domElement && o.renderer.domElement.parentElement) || (hasDom ? document.body : null);
  const logoUrl = () => new URL('../../vendor/google-maps-attribution/GoogleMaps_Logo_WithLightOutline.svg', import.meta.url).href;
  function mountDom() {
    const h = host(); if (!hasDom || !h || wrapEl) return;
    if (!document.getElementById('g3d-css')) { const s = document.createElement('style'); s.id = 'g3d-css'; s.textContent = CSS + (o.css || ''); document.head.appendChild(s); }
    else if (o.css && !document.getElementById('g3d-css-' + id)) { const s = document.createElement('style'); s.id = 'g3d-css-' + id; s.textContent = o.css; document.head.appendChild(s); }
    if (getComputedStyle(h).position === 'static') h.style.position = 'relative';
    wrapEl = document.createElement('div'); wrapEl.className = 'g3d-wrap g3d-' + id + (o.cls ? ' ' + o.cls : '');
    wrapEl.innerHTML = '<div class="g3d-box"><div class="g3d-row" role="button" tabindex="0"><img class="g3d-logo" alt="Google Maps"><span class="g3d-data"></span></div><div class="g3d-own"></div></div><div class="g3d-pop" role="dialog"></div>';
    const img = wrapEl.querySelector('.g3d-logo'); img.src = logoUrl(); img.setAttribute('aria-label', 'Google Maps');
    dataEl = wrapEl.querySelector('.g3d-data'); popEl = wrapEl.querySelector('.g3d-pop'); wrapEl.querySelector('.g3d-own').textContent = S.own;
    const row = wrapEl.querySelector('.g3d-row');
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'dblclick', 'touchstart', 'touchend', 'wheel']) wrapEl.addEventListener(ev, (e) => e.stopPropagation(), ev.startsWith('touch') || ev === 'wheel' ? { passive: true } : undefined);
    row.addEventListener('click', (e) => { e.stopPropagation(); wrapEl.classList.toggle('open'); fillPop(); });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
    popEl.addEventListener('click', (e) => { e.stopPropagation(); wrapEl.classList.remove('open'); });
    noteEl = document.createElement('div'); noteEl.className = 'g3d-note';
    h.appendChild(wrapEl); h.appendChild(noteEl);
    wrapEl.classList.toggle('on', ctl.active);
  }
  function unmountDom() {
    try { wrapEl && wrapEl.remove(); noteEl && noteEl.remove(); btn && btn.remove(); } catch (_) { /* */ }
    wrapEl = dataEl = popEl = noteEl = null; btn = null; btnOwn = false; clearTimeout(noteT);
  }
  function fillPop() {
    if (!popEl) return;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    popEl.innerHTML = '<b>' + esc(S.data) + '</b><p>Google' + (attrText ? ' · ' + esc(attrText) : '') + '</p><p>' + esc(S.hybrid) + '</p>' + (o.osm !== false ? '<p>' + esc(S.osm) + '</p>' : '');
  }
  function note(text, ms = 4200) { if (!noteEl) return; noteEl.textContent = text; noteEl.classList.add('show'); clearTimeout(noteT); noteT = setTimeout(() => noteEl && noteEl.classList.remove('show'), ms); }
  const googleOn = () => ctl.mode === 'google' && (ctl.active || (!!tiles && ctl.status !== 'failed'));   // shown or loading
  function ensureButton() {
    if (!hasDom || !google3dConfigured() || !wrapEl) return;
    if (!btn) {
      btn = document.createElement('button'); btn.type = 'button'; btn.className = 'g3d-btn';
      btn.innerHTML = '<span class="i" aria-hidden="true"></span><span class="t"></span>';
      for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'dblclick', 'touchstart', 'touchend']) btn.addEventListener(ev, (e) => e.stopPropagation(), ev.startsWith('touch') ? { passive: true } : undefined);
      // Google shown (or loading) → classic; classic (chosen, or after a failure) → try Google again
      btn.addEventListener('click', (e) => { e.stopPropagation(); ctl.setMode(googleOn() ? 'classic' : 'google'); });
      btnOwn = !!(o.mountButton && o.mountButton(btn));
      if (!btnOwn) wrapEl.insertBefore(btn, wrapEl.firstChild);
    }
    const g = googleOn(), i = btn.querySelector('.i'), t = btn.querySelector('.t');
    const ic = g ? '🌍' : '🗺', tx = g ? S.on : S.off;
    if (i.textContent !== ic) i.textContent = ic; if (t.textContent !== tx) t.textContent = tx;
    btn.title = S.aria; btn.setAttribute('aria-label', S.aria + ' — ' + tx); btn.setAttribute('aria-pressed', g ? 'true' : 'false');
    btn.classList.toggle('on', g); btn.classList.toggle('busy', g && ctl.status === 'loading');
  }

  /* ---- the 3D tiles renderer */
  function loadLib() {
    if (libP) return libP;
    libP = Promise.all([
      import('../../vendor/3d-tiles-renderer/src/three/TilesRenderer.js'),
      import('../../vendor/3d-tiles-renderer/src/plugins/three/GoogleCloudAuthPlugin.js'),
      import('../../vendor/3d-tiles-renderer/src/plugins/three/fade/TilesFadePlugin.js'),
      import('../../vendor/3d-tiles-renderer/src/plugins/three/GLTFExtensionsPlugin.js'),
      import('../../vendor/3d-tiles-renderer/src/plugins/three/UnloadTilesPlugin.js'),
      import('../../vendor/3d-tiles-renderer/src/three/math/GeoConstants.js'),
      import('../../vendor/3d-tiles-renderer/src/three/math/Ellipsoid.js'),
      import('../../vendor/3d-tiles-renderer/src/base/constants.js'),
      import('three/addons/loaders/DRACOLoader.js'),
    ]).then(([TR, GA, FD, GE, UL, GC, EL, CN, DR]) => (lib = { TilesRenderer: TR.TilesRenderer, GoogleCloudAuthPlugin: GA.GoogleCloudAuthPlugin, TilesFadePlugin: FD.TilesFadePlugin, GLTFExtensionsPlugin: GE.GLTFExtensionsPlugin, UnloadTilesPlugin: UL.UnloadTilesPlugin, E: GC.WGS84_ELLIPSOID, OBJECT_FRAME: EL.OBJECT_FRAME, FAILED: CN.FAILED, DRACOLoader: DR.DRACOLoader }));
    return libP;
  }
  // Google's error text of a failed response (403 EEA / API not enabled / referer, 429 quota) without the key
  function noteError(res) {
    try {
      const st = res.status;
      res.clone().text().then((t) => {
        let msg = ''; try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.status)) || ''; } catch (_) { msg = String(t || '').slice(0, 200); }
        ctl.reason = (st + ' ' + msg).replace(/key=[^&\s"]+/g, 'key=…').trim();
        console.warn('[g3d] Google Map Tiles API answered ' + ctl.reason);
      }).catch(() => { ctl.reason = String(st); });
    } catch (_) { /* */ }
  }
  // the clip boxes (the plot) and the dusk / night tint on every material of a tile
  function patchMaterial(m) {
    if (!m || m.userData.g3d) return; m.userData.g3d = true;
    m.toneMapped = false; m.fog = true; if (m.color) { m.userData.g3dBase = m.color.clone(); m.color.multiplyScalar(tintNow); }
    if (!clipBoxes.length) return;
    // the fade plugin sets / resets material.onBeforeCompile itself (fade in, then a no-op): compose with it, never replace it
    // (its patch leaves "void main(\n\t) {", hence the whitespace-tolerant match below)
    const clipPatch = (sh) => {
      sh.uniforms.uG3dClip = CLIP; sh.uniforms.uG3dClipN = CLIPN;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vG3dW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvG3dW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vG3dW;\nuniform vec4 uG3dClip[8];\nuniform int uG3dClipN;')
        .replace(/void\s+main\s*\(\s*\)\s*\{/, 'void main() {\n\tfor (int i = 0; i < 4; i++) { if (i >= uG3dClipN) break; vec4 a = uG3dClip[2 * i]; vec4 b = uG3dClip[2 * i + 1]; vec2 d = vG3dW.xz - a.xy;\n\t\tif (abs(dot(d, a.zw)) < b.x && abs(-d.x * a.w + d.y * a.z) < b.y && vG3dW.y < b.z) discard; }');
    };
    let inner = m.onBeforeCompile;
    const outer = function (sh, r) { if (inner) inner.call(this, sh, r); clipPatch(sh); };
    Object.defineProperty(m, 'onBeforeCompile', { configurable: true, get: () => outer, set: (f) => { inner = f; } });
    m.customProgramCacheKey = () => 'g3d-clip|' + (inner ? String(inner) : '');
    m.needsUpdate = true;
  }
  function applyTint(t) {
    if (Math.abs(t - tintNow) < 0.01) return; tintNow = t;
    if (tiles) tiles.group.traverse((x) => { if (x.isMesh) for (const m of Array.isArray(x.material) ? x.material : [x.material]) if (m && m.color && m.userData.g3dBase) m.color.copy(m.userData.g3dBase).multiplyScalar(t); });
  }
  function startTiles() {
    if (tiles || ctl.disposed) return;
    const L = lib;
    tiles = new L.TilesRenderer();
    auth = new L.GoogleCloudAuthPlugin({ apiToken: key(), autoRefreshToken: true });
    tiles.registerPlugin(auth);
    // watcher (runs first): delegates to the auth plugin, records Google's error answers for the fallback
    // The root request is checked here first: a 4xx there is the key / account / region (EEA) / quota, not an expired
    // session, so it is recorded and ends the attempt quietly (the auth plugin would retry it and lose Google's message).
    const quiet = (m) => { const e = new Error('[g3d] ' + m); e.quiet = true; return e; };
    tiles.registerPlugin({
      name: 'VRC_G3D_WATCH', priority: -2,
      async fetchData(uri, opts) {
        if (auth._tokenRefreshPromise === null && /\/3dtiles\/root\.json/.test(String(uri))) {
          let res; try { res = await fetch(uri, opts); } catch (e) { failedSeen++; if (!ctl.reason) ctl.reason = 'network: ' + (e && e.message ? e.message : e); throw quiet('root: ' + ctl.reason); }
          if (!res.ok) { failedSeen++; noteError(res); throw quiet('root: HTTP ' + res.status); }
          lastOk = performance.now(); return res;
        }
        return auth.fetchData(uri, opts).then((res) => {
          if (res && !res.ok && String(uri).indexOf(ROOT_HOST) >= 0 && res.status !== 404) { failedSeen++; noteError(res); }
          else if (res && res.ok) lastOk = performance.now();
          return res;
        }, (e) => { failedSeen++; if (!ctl.reason) ctl.reason = 'network: ' + (e && e.message ? e.message : e); throw e; });
      },
    });
    try {
      draco = new L.DRACOLoader(); draco.setDecoderPath(new URL('../../vendor/addons/libs/draco/gltf/', import.meta.url).href);
      draco.setWorkerLimit(phone ? 2 : 4);
      tiles.registerPlugin(new L.GLTFExtensionsPlugin({ dracoLoader: draco, rtc: true, metadata: false }));
    } catch (e) { console.warn('[g3d] draco', e); }
    tiles.registerPlugin(new L.TilesFadePlugin({ fadeDuration: phone ? 200 : 300, maximumFadeOutTiles: phone ? 20 : 50 }));
    if (phone) { try { tiles.registerPlugin(new L.UnloadTilesPlugin()); } catch (_) { /* */ } }
    // detail / memory: phones get coarser tiles, fewer parallel jobs and a small cache
    tiles.errorTarget = phone ? 36 : 18;
    tiles.downloadQueue.schedulingCallback = tiles.parseQueue.schedulingCallback = (f) => { jobs.push(f); };
    tiles.downloadQueue.maxJobs = phone ? 12 : 24;
    tiles.parseQueue.maxJobs = phone ? 3 : 8;
    const C = tiles.lruCache, MB = 1024 * 1024;
    if (phone) { C.minSize = 450; C.maxSize = 800; C.minBytesSize = 110 * MB; C.maxBytesSize = 170 * MB; }
    else { C.minSize = 3000; C.maxSize = 5000; C.minBytesSize = 320 * MB; C.maxBytesSize = 460 * MB; }
    tiles.addEventListener('load-model', (e) => {
      models++; lastOk = performance.now();
      try { e.scene.traverse((x) => { x.userData.g3d = true; if (x.isMesh) { x.castShadow = false; x.receiveShadow = false; for (const m of Array.isArray(x.material) ? x.material : [x.material]) patchMaterial(m); } }); } catch (_) { /* */ }
      if (!firstAt) { firstAt = performance.now(); firstFrame = frames; onFirstTile(); }
    });
    holder.add(tiles.group);
    tiles.setCamera(o.camera || new THREE.PerspectiveCamera());
    resT = 0; anchor = null; t0 = performance.now(); models = 0; failedSeen = 0; firstAt = 0; covChecked = false; dyTarget = null; locked = false; frames = 0; firstFrame = 0; jobs.length = 0;
    ctl.status = 'loading'; ctl.reason = '';
  }
  function stopTiles() {
    if (!tiles) return;
    try { holder.remove(tiles.group); } catch (_) { /* */ }
    try { tiles.dispose(); } catch (e) { console.warn('[g3d] dispose', e); }
    try { tiles.group.traverse((x) => { if (x.geometry) x.geometry.dispose(); const ms = Array.isArray(x.material) ? x.material : x.material ? [x.material] : []; for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); } }); } catch (_) { /* */ }
    try { draco && draco.dispose(); } catch (_) { /* */ }
    tiles = null; auth = null; draco = null; attrText = ''; jobs.length = 0;
  }
  function onFirstTile() { ctl.status = 'ok'; }
  // the Google city replaces the classic one only once it stands on the right height (first vertical lock), so the visitor
  // never sees an empty world or the underside of the tiles while they load; without road points: 4 s after the first tile
  function reveal() {
    if (ctl.active || ctl.mode !== 'google' || !tiles) return;
    updateAttr(); showGoogle(); say(S.onMsg, 2200); note(S.hybrid, 5200); ensureButton();
  }
  function fail(why, msg) {
    if (ctl.status === 'failed') return;
    ctl.status = 'failed'; if (why && !ctl.reason) ctl.reason = why;
    console.warn('[g3d] Google 3D unavailable → classic world (' + (ctl.reason || why || '?') + ')');
    stopTiles(); showClassic();
    say(msg || S.fail, 5200); ensureButton();
  }
  const modeChanged = () => { try { o.onMode && o.onMode(ctl); } catch (e) { console.warn('[g3d] onMode', e); } };
  function setClassicHidden(h) { try { o.hideClassic && o.hideClassic(h); } catch (e) { console.warn('[g3d] hideClassic', e); } }
  function showGoogle() { if (ctl.active) return; ctl.active = true; setClassicHidden(true); holder.visible = true; if (pad) pad.visible = true; if (wrapEl) wrapEl.classList.add('on'); modeChanged(); }
  const wanting = () => ctl.mode === 'google' && !!tiles && !ctl.active;   // loading: the classic city is still shown
  function showClassic() { const was = ctl.active; ctl.active = false; holder.visible = false; if (pad) pad.visible = false; if (wrapEl) wrapEl.classList.remove('on', 'open'); if (was) { setClassicHidden(false); modeChanged(); } }
  async function startGoogle() {
    try { await loadLib(); } catch (e) { console.warn('[g3d] library', e); fail('library: ' + (e && e.message ? e.message : e)); return; }
    if (ctl.disposed || !ctl.entered || ctl.mode !== 'google' || ctl.status === 'failed') return;
    startTiles();
  }

  /* ---- placement: the tiles' East-Up-South frame at the camera, rotated / scaled into the world frame there */
  const A = 6378137, E2 = 0.00669437999014, D2R = Math.PI / 180;
  function localAxes(lat, lon) {
    // world displacement of 10 true metres east and south at (lat, lon), measured through the world's own geo frame
    const s = Math.sin(lat * D2R), w = 1 - E2 * s * s, N = A / Math.sqrt(w), M = A * (1 - E2) / (w * Math.sqrt(w));
    const dLon = 10 / (N * Math.cos(lat * D2R)) / D2R, dLat = 10 / M / D2R;
    const p0 = FR.fromLL(lat, lon), pe = FR.fromLL(lat, lon + dLon), ps = FR.fromLL(lat - dLat, lon);
    const ex = (pe[0] - p0[0]) / 10, ez = (pe[1] - p0[1]) / 10, sx = (ps[0] - p0[0]) / 10, sz = (ps[1] - p0[1]) / 10;
    // rotation that takes east (1, 0) to (ex, ez) about +y (three: x' = x cos θ + z sin θ, z' = −x sin θ + z cos θ)
    return { rot: Math.atan2(-ez, ex), k: (Math.hypot(ex, ez) + Math.hypot(sx, sz)) / 2 };
  }
  function reanchor(cx, cz) {
    const L = lib; if (!L || !tiles) return;
    const [lat, lon] = FR.toLL(cx, cz);
    L.E.getRotationMatrixFromAzElRoll(lat * D2R, lon * D2R, 0, 0, 0, m4, L.OBJECT_FRAME); // x west, y up, z north
    L.E.getCartographicToPosition(lat * D2R, lon * D2R, H0, v3);
    m4.setPosition(v3).invert().premultiply(RY);                                          // → x east, y up, z south
    m4.decompose(tiles.group.position, tiles.group.quaternion, tiles.group.scale);
    tiles.group.updateMatrix();
    const ax = localAxes(lat, lon);
    anchor = { x: cx, z: cz, rot: ax.rot, k: ax.k };
    applyHolder();
  }
  const _r = new THREE.Matrix4(), _s = new THREE.Matrix4();
  function applyHolder() {
    if (!anchor) return;
    holder.matrix.makeTranslation(anchor.x, dy, anchor.z).multiply(_r.makeRotationY(anchor.rot)).multiply(_s.makeScale(anchor.k, anchor.k, anchor.k));
    holder.matrixWorldNeedsUpdate = true; holder.updateMatrixWorld(true);
  }
  function hitY(x, z) {
    ray.set(v3.set(x, 1500, z), DOWN); ray.far = 3000;
    const hits = []; try { ray.intersectObject(tiles.group, true, hits); } catch (_) { return null; }
    return hits.length ? hits[0].point.y : null;
  }
  // vertical lock: the low quartile of the Google surface over road points near the camera (cars, trees, roofs skipped)
  function lockGround(cx, cz) {
    let pts = []; try { pts = (o.refPoints && o.refPoints(cx, cz)) || []; } catch (_) { pts = []; }
    if (pts.length < 3) return;
    const diff = []; for (const [x, z] of pts.slice(0, 14)) { const y = hitY(x, z); if (y != null) diff.push(y - dy); }
    if (diff.length < Math.max(3, Math.ceil(Math.min(pts.length, 14) * 0.4))) return;
    diff.sort((a, b) => a - b); const lo = diff[Math.floor((diff.length - 1) * 0.25)];
    if (Math.abs(lo) > 90) return;                    // tiles still coarse (or far off): ignore
    dyTarget = clamp(-lo, -90, 90);
    if (!locked || Math.abs(dyTarget - dy) > 4) { dy = dyTarget; applyHolder(); }   // first lock / a jump (teleport): at once
    locked = true;
  }
  // no photorealistic coverage: the finest tile on screen stays coarse once the downloads have settled
  function coverageCheck(now) {
    if (covChecked || !firstAt || now - firstAt < COVER_WAIT || frames - firstFrame < 30) return;
    const st = tiles.stats; if (st.downloading > 0 || st.parsing > 0) { if (now - firstAt < COVER_WAIT * 3 || frames - firstFrame < 90) return; }
    covChecked = true;
    let min = Infinity; for (const t of tiles.visibleTiles || []) if (t && isFinite(t.geometricError)) min = Math.min(min, t.geometricError);
    ctl.finestError = isFinite(min) ? +min.toFixed(2) : null;
    if (isFinite(min) && min > minDetail) { ctl.reason = 'no photorealistic 3D coverage (finest tile ' + min.toFixed(1) + ' m)'; fail('coverage', S.noCov); }
  }
  const worldShown = () => { if (o.visible) { try { if (!o.visible()) return false; } catch (_) { /* */ } } for (let p = wrap; p; p = p.parent) if (!p.visible) return false; return true; };

  /* ---- per frame */
  ctl.update = (camera, dt = 0.016) => {
    if (ctl.disposed || !ctl.entered) return;
    const now = performance.now();
    btnT += dt; if (btnT > 0.5) { btnT = 0; ensureButton(); if (o.tint) { try { applyTint(clamp(+o.tint() || 1, 0.05, 1)); } catch (_) { /* */ } } }
    if (!tiles || !camera || !(ctl.active || wanting())) return;
    if (!worldShown()) return;                        // e.g. deep in the car park: no streaming
    camera.getWorldPosition(camP);
    if (!anchor || Math.hypot(camP.x - anchor.x, camP.z - anchor.z) > 150) reanchor(camP.x, camP.z);
    if (dyTarget != null && Math.abs(dyTarget - dy) > 0.02) { dy += (dyTarget - dy) * Math.min(1, dt * 1.5); if (Math.abs(dyTarget - dy) < 0.02) dy = dyTarget; applyHolder(); }
    if (tiles.camera !== camera && tiles.cameras && !tiles.cameras.includes(camera)) { try { for (const c of [...tiles.cameras]) tiles.deleteCamera(c); tiles.setCamera(camera); resT = 0; } catch (_) { /* */ } }
    resT -= dt;
    if (resT <= 0 && o.renderer) {
      resT = 1; o.renderer.getSize(size); const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, phone ? 1.5 : 2);
      tiles.setResolution(camera, Math.max(1, Math.round(size.x * dpr)), Math.max(1, Math.round(size.y * dpr)));
    }
    try { tiles.update(); } catch (e) { if (!ctl._uErr) { ctl._uErr = 1; console.warn('[g3d] update', e); } }
    frames++; if (jobs.length) { const run = jobs.splice(0); for (const f of run) { try { f(); } catch (e) { console.warn('[g3d] queue', e); } } }
    if (!tiles) return;
    if (ctl.status === 'loading') {
      if (tiles.rootLoadingState === lib.FAILED) fail('root tileset');
      else if (now - t0 > START_TIMEOUT && frames > 60 && models === 0) fail(ctl.reason || 'timeout');
      else if (failedSeen >= 6 && models === 0) fail(ctl.reason || 'tiles failed');
      if (!tiles) return;
    } else if (ctl.status === 'ok') {
      if (failedSeen >= 24 && now - lastOk > 30000) { fail(ctl.reason || 'tiles failed'); return; }
      coverageCheck(now); if (!tiles) return;
    }
    lockT -= dt; if (lockT <= 0 && models > 0) { lockT = locked ? 0.6 : 0.25; lockGround(camP.x, camP.z); }
    if (wanting() && ctl.status === 'ok' && (locked || (now - firstAt > 4000 && frames - firstFrame > 20))) reveal();
    attrT -= dt; if (attrT <= 0) { attrT = 1; updateAttr(); }
  };
  // the data attributions of the tiles in view (Google's asset.copyright, aggregated by the auth plugin)
  function updateAttr() {
    if (!tiles) return; let s = '';
    try { const Ar = tiles.getAttributions ? tiles.getAttributions() : []; for (const a of Ar) if (a && a.type === 'string' && a.value) s = a.value; } catch (_) { /* */ }
    if (!s && auth && auth._attributionsManager) { try { s = auth._attributionsManager.toString(); } catch (_) { /* */ } }
    if (s !== attrText) { attrText = s; if (wrapEl && wrapEl.classList.contains('open')) fillPop(); }
    if (dataEl && dataEl.textContent !== (s || 'Google')) dataEl.textContent = s || 'Google';
  }

  /* ---- world enter / exit, mode switch */
  ctl.enter = () => {
    if (ctl.disposed) return false;
    ctl.entered = true; mountDom(); ensureButton();
    if (ctl.mode === 'google' && google3dConfigured() && ctl.status !== 'failed') { say(S.loading, 1800); startGoogle(); return true; }
    showClassic(); return false;
  };
  ctl.exit = () => { ctl.entered = false; stopTiles(); showClassic(); if (ctl.status !== 'off' && ctl.status !== 'failed') ctl.status = 'idle'; unmountDom(); };
  ctl.setMode = (m) => {
    if (m !== 'google' && m !== 'classic') return;
    ctl.mode = m; lsSet(id, m);
    if (!ctl.entered) return;
    if (m === 'google') {
      if (!google3dConfigured()) return;
      if (ctl.status === 'failed') { ctl.status = 'idle'; ctl.reason = ''; }
      say(S.loading, 2400); startGoogle();
    } else { stopTiles(); if (ctl.status !== 'off') ctl.status = 'idle'; showClassic(); say(S.offMsg, 2200); }
    ensureButton();
  };
  ctl.dispose = () => {
    if (ctl.disposed) return; ctl.disposed = true;
    ctl.entered = false; stopTiles(); showClassic(); unmountDom();
    try { wrap.parent && wrap.parent.remove(wrap); } catch (_) { /* */ }
    if (pad) { pad.traverse((x) => { if (x.geometry) x.geometry.dispose(); }); try { pad.children[0] && pad.children[0].material.dispose(); } catch (_) { /* */ } }
    lib = null; libP = null;
  };
  ctl.stats = () => {
    const out = { mode: ctl.mode, active: ctl.active, status: ctl.status, reason: ctl.reason, models, dy: +dy.toFixed(2), dyTarget: dyTarget == null ? null : +dyTarget.toFixed(2), locked, finestError: ctl.finestError ?? null, anchor: anchor ? { x: Math.round(anchor.x), z: Math.round(anchor.z), rot: +anchor.rot.toFixed(4), k: +anchor.k.toFixed(5) } : null, attributions: attrText, clip: clipBoxes.length, clipBoxes: clipBoxes.map((c) => [c.x, c.z, c.ux, c.uz, c.hw, c.hd].map((v) => +(+v).toFixed(3))) };
    if (tiles) { out.tiles = Object.assign({}, tiles.stats); out.cacheMB = Math.round((tiles.lruCache.cachedBytes || 0) / 1048576); out.visible = tiles.visibleTiles ? tiles.visibleTiles.size : null; out.errorTarget = tiles.errorTarget; }
    return out;
  };
  Object.defineProperty(ctl, 'tiles', { get: () => tiles });
  Object.defineProperty(ctl, 'button', { get: () => btn });
  ctl.holder = holder; ctl.group = wrap; ctl.strings = S; ctl.localAxes = localAxes;
  try { if (typeof location !== 'undefined' && /[?&]g3ddebug\b/.test(location.search)) (window.__vrcG3d = window.__vrcG3d || {})[id] = ctl; } catch (_) { /* */ }
  return ctl;
}
export default attachGoogle3D;
