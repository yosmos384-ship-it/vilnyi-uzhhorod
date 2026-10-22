// ЖК VILNYI (Uzhhorod) — «Location on Google Maps» (section #gmaps). Self-contained: bootstraps itself on #gmaps.
//   1. 3D flyover — Maps JavaScript API 3D Maps (Map3DElement, flyCameraAround). Where Google has no photorealistic
//      mesh the same element shows Google satellite imagery on 3D terrain (worldwide). No WebGL / no maps3d → a tilted
//      2D satellite map; Google not reachable at all → the poster stays (slow pan) with the Google Maps link.
//   2. Interactive map + «what's nearby» — Places API (New) Place.searchNearby at runtime, per category chip; list with
//      straight-line distance and estimated (or, with MAPS.ROUTE_TIMES, Routes API) walking / driving minutes.
//      Places fails → the curated list of panorama.js (OpenStreetMap) is shown instead.
//   3. Navigate buttons — Google Maps directions and Waze deep links (plain links, work without the API).
//   4. Street View of the street in front of the project — hidden when Google has no outdoor panorama within 120 m.
// Nothing is requested from Google until the section approaches the viewport. Places content is kept in memory for this
// page view only (never in localStorage) — Google Maps Platform terms. Google's logo and attributions are never hidden.
import { PROJECT } from './data.js';
import { lang, onLangChange } from './i18n.js';
import { mt, GMAPS_LANG } from './i18n-maps.js';
import { POIS } from './panorama.js';
import { poiName, CARD } from './i18n-panorama.js';
import { GOOGLE_MAPS_API_KEY, MAPS } from './maps-config.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LAT = PROJECT?.geo?.lat ?? 48.61133, LNG = PROJECT?.geo?.lon ?? 22.27685;   // plot centre, OpenStreetMap (data.js)
const HERE = { lat: LAT, lng: LNG };
const REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

// ---------------------------------------------------------------- deep links (no API needed)
export const LINKS = {
  directions: (mode = 'driving') => `https://www.google.com/maps/dir/?api=1&destination=${LAT},${LNG}&travelmode=${mode}`,
  waze: () => `https://waze.com/ul?ll=${LAT},${LNG}&navigate=yes`,
  open: () => `https://www.google.com/maps/search/?api=1&query=${LAT},${LNG}`,
  route: (to, placeId, mode) => `https://www.google.com/maps/dir/?api=1&origin=${LAT},${LNG}&destination=${to.lat},${to.lng}${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ''}&travelmode=${mode}`,
};

// ---------------------------------------------------------------- distances
function metres(a, b) {
  const R = 6371008.8, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function fmtDist(m) {
  const u = CARD[lang] || CARD.en;
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} ${u.m}`;
  let s = (m / 1000).toFixed(m < 10000 ? 1 : 0); if (u.comma) s = s.replace('.', ',');
  return `${s} ${u.km}`;
}
// estimates (marked «≈»): walking 80 m/min with a 1.25 detour factor; city driving 500 m/min with 1.35 + 2 min parking
const estWalk = m => Math.max(1, Math.round(m * 1.25 / 80));
const estDrive = m => Math.max(2, Math.round(m * 1.35 / 500) + 2);

// ---------------------------------------------------------------- categories
// types: Places API (New) Table A primary types. cur: the curated fallback from panorama.js POIS (OpenStreetMap).
const CATS = [
  { id: 'school', types: ['primary_school', 'secondary_school', 'school'], cur: p => p.cat === 'education' && p.kind !== 'kinder' },
  { id: 'kinder', types: ['preschool'], cur: p => p.kind === 'kinder' },
  { id: 'shop', types: ['supermarket', 'grocery_store'], cur: p => p.cat === 'shopping' && !p.onSite },
  { id: 'transport', types: ['bus_stop', 'bus_station', 'train_station', 'transit_station'], cur: p => p.cat === 'transport' && !/^border|airport/.test(p.id) },
  { id: 'park', types: ['park'], cur: p => p.cat === 'parks' && p.kind !== 'river' },
  { id: 'health', types: ['hospital'], radius: 4000, cur: p => p.cat === 'health' && p.kind !== 'pharmacy' },
  { id: 'centre', types: null, cur: p => ['uzh', 'linden', 'korzo', 'narodna', 'ped-bridge', 'castle', 'cathedral'].includes(p.id) },
];

// ---------------------------------------------------------------- Google loader (one script, lazy)
let gPromise = null, authFailed = false;
const authWatch = new Set();
function loadGoogle() {
  if (gPromise) return gPromise;
  gPromise = new Promise((resolve, reject) => {
    if (!MAPS.ENABLED || !GOOGLE_MAPS_API_KEY) { reject(new Error('maps disabled')); return; }
    if (window.google?.maps?.importLibrary) { resolve(window.google.maps); return; }
    const cb = '__vrcGmapsReady';
    const timer = setTimeout(() => reject(new Error('maps timeout')), 20000);
    window[cb] = () => { clearTimeout(timer); resolve(window.google.maps); };
    // Google calls this when the key is refused (referrer not allowed, API not enabled, billing) — fall back everywhere.
    window.gm_authFailure = () => { authFailed = true; authWatch.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } }); };
    const q = new URLSearchParams({ key: GOOGLE_MAPS_API_KEY, v: 'weekly', loading: 'async', callback: cb, language: GMAPS_LANG[lang] || 'uk', region: 'UA' });
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${q}`; s.async = true;
    s.onerror = () => { clearTimeout(timer); reject(new Error('maps script blocked')); };
    document.head.append(s);
  });
  gPromise.catch(() => {});
  return gPromise;
}
const lib = name => loadGoogle().then(g => g.importLibrary(name));
const hasWebGL = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };

// ---------------------------------------------------------------- DOM texts
let root = null;
function applyTexts() {
  root.querySelectorAll('[data-mt]').forEach(el => { el.textContent = mt(el.dataset.mt); });
  root.querySelectorAll('[data-mt-attr]').forEach(el => el.dataset.mtAttr.split(';').forEach(pair => {
    const [a, k] = pair.split(':'); if (a && k) el.setAttribute(a.trim(), mt(k.trim()));
  }));
  $('#gmxDir').href = LINKS.directions(); $('#gmxWaze').href = LINKS.waze(); $('#gmxOpen').href = LINKS.open();
  fly.label(); renderChips(); renderList();
  if (sv.date) $('#gmxSvDate').textContent = mt('sv.date', { d: sv.date });
}

// ================================================================ 1. FLYOVER
const fly = {
  state: 'poster',          // poster | loading | 3d | 2d | off
  map: null, paused: REDUCED, userPaused: REDUCED, visible: false, toOrbit: false, steady: false,
  prof() {
    if (MAPS.PHOTOREAL_3D === true) return { range: 430, tilt: 67, alt: 110 };
    if (MAPS.PHOTOREAL_3D === false) return { range: 1050, tilt: 58, alt: 120 };
    return { range: 640, tilt: 63, alt: 115 };
  },
  label() {
    const b = $('#gmxFlyBadge'), btn = $('#gmxFlyBtn');
    const k = { loading: 'fly.loading', '3d': MAPS.PHOTOREAL_3D === true ? 'fly.photo' : MAPS.PHOTOREAL_3D === false ? 'fly.terrain' : 'fly.g3d', '2d': 'fly.flat', off: 'fly.off', poster: 'fly.poster' }[this.state];
    if (b) b.textContent = mt(k);
    if (btn) {
      btn.hidden = !(this.state === '3d' || this.state === '2d');
      const play = this.paused;
      btn.setAttribute('aria-label', mt(play ? 'fly.play' : 'fly.pause')); btn.title = btn.getAttribute('aria-label');
      btn.dataset.play = play ? '1' : '0';
    }
    root.dataset.fly = this.state;
  },
  set(state) { this.state = state; this.label(); },
  async start() {
    if (this.state !== 'poster') return;
    this.set('loading');
    let g;
    try { g = await loadGoogle(); } catch (e) { this.set('off'); return; }
    if (authFailed) { this.set('off'); return; }
    if (hasWebGL()) {
      try { await this.start3d(); return; } catch (e) { console.info('[maps] 3D flyover unavailable, 2D fallback:', e?.message || e); }
    }
    if (authFailed) { this.off(); return; }
    try { await this.start2d(g); if (authFailed) this.off(); } catch (e) { console.info('[maps] 2D fallback unavailable:', e?.message || e); this.off(); }
  },
  off() {
    clearInterval(this.timer); this.map = null; this.mode = null;
    const st = $('#gmxFlyStage'); if (st) st.innerHTML = '';
    root.classList.remove('gmx-live'); this.set('off');
  },
  async start3d() {
    const m3 = await lib('maps3d');
    const { Map3DElement, MapMode, Marker3DElement } = m3;
    if (!Map3DElement) throw new Error('no Map3DElement');
    const p = this.prof(), stage = $('#gmxFlyStage');
    const opts = { center: { lat: LAT, lng: LNG, altitude: p.alt }, range: p.range * 1.8, tilt: p.tilt - 10, heading: 200, mode: MapMode?.HYBRID ?? 'HYBRID', defaultUIHidden: true };
    const GH = m3.GestureHandling || window.google?.maps?.maps3d?.GestureHandling;
    if (GH?.COOPERATIVE) opts.gestureHandling = GH.COOPERATIVE;
    const map = new Map3DElement(opts);
    map.classList.add('gmx-3d');
    map.setAttribute('aria-label', mt('fly.label'));
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('3D map did not settle in 20 s')), 20000);
      map.addEventListener('gmp-error', e => { clearTimeout(t); reject(new Error('gmp-error ' + (e?.message || ''))); }, { once: true });
      map.addEventListener('gmp-steadychange', e => { if (e.isSteady && !this.steady) { this.steady = true; clearTimeout(t); resolve(); } });
      authWatch.add(() => { clearTimeout(t); reject(new Error('auth')); });
      stage.append(map);
    }).catch(err => { map.remove(); throw err; });
    // the project: a branded pin raised above the roofs (Marker3DElement; the label is plain text)
    try {
      if (Marker3DElement) {
        const mk = new Marker3DElement({ position: { lat: LAT, lng: LNG, altitude: 75 }, altitudeMode: 'RELATIVE_TO_GROUND', extruded: true, label: 'ЖК VILNYI' });
        const tpl = document.createElement('template');
        const img = document.createElement('img'); img.src = 'assets/maps/pin.svg'; img.width = 44; img.height = 56; img.alt = '';
        tpl.content.append(img); mk.append(tpl);
        map.append(mk);
      }
    } catch (e) { /* the flyover works without the pin */ }
    this.map = map; this.mode = '3d';
    map.addEventListener('gmp-animationend', () => {
      if (this.paused || !this.visible) return;
      this.orbit();
    });
    // a visitor who grabs the map wants to explore: stop the orbit (the play button resumes it)
    ['pointerdown', 'wheel'].forEach(ev => map.addEventListener(ev, () => { if (!this.paused) this.pause(true); }, { passive: true }));
    this.set('3d'); root.classList.add('gmx-live');
    if (!this.paused && this.visible) this.approach(); else map.flyCameraTo?.({ endCamera: this.cam(200), durationMillis: 0 });
  },
  cam(heading) { const p = this.prof(); return { center: { lat: LAT, lng: LNG, altitude: p.alt }, range: p.range, tilt: p.tilt, heading }; },
  approach() { this.toOrbit = true; this.map.flyCameraTo({ endCamera: this.cam(this.map.heading ?? 200), durationMillis: 3500 }); },
  orbit() {
    if (this.mode !== '3d' || !this.map) return;
    if (this.toOrbit) this.toOrbit = false;
    this.map.flyCameraAround({ camera: this.cam(this.map.heading ?? 200), durationMillis: 70000, repeatCount: 1 });
  },
  async start2d(g) {
    const { Map } = await lib('maps');
    const stage = $('#gmxFlyStage'), host = document.createElement('div');
    host.className = 'gmx-2d'; host.setAttribute('aria-label', mt('fly.label')); host.setAttribute('role', 'region');
    stage.append(host);
    const map = new Map(host, { center: HERE, zoom: 17, mapTypeId: 'hybrid', tilt: 45, heading: 0, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false, ...(MAPS.MAP_ID ? { mapId: MAPS.MAP_ID } : {}) });
    new g.Marker({ position: HERE, map, title: 'ЖК VILNYI', icon: { url: 'assets/maps/pin.svg', scaledSize: new g.Size(40, 51), anchor: new g.Point(20, 51) } });
    this.map = map; this.mode = '2d';
    // 45° imagery (where Google has it) → turn the view by 90° every 7 s; otherwise a slow drift around the plot
    let k = 0;
    this.timer = setInterval(() => {
      if (this.paused || !this.visible) return;
      k++;
      if ((map.getTilt?.() || 0) > 0) map.setHeading(((map.getHeading?.() || 0) + 90) % 360);
      else { const a = k * 0.6, r = 0.0007; map.panTo({ lat: LAT + r * Math.sin(a) * 0.66, lng: LNG + r * Math.cos(a) }); }
    }, 7000);
    host.addEventListener('pointerdown', () => { if (!this.paused) this.pause(true); }, { passive: true });
    this.set('2d'); root.classList.add('gmx-live');
  },
  pause(user = false) {
    this.paused = true; if (user) this.userPaused = true;
    if (this.mode === '3d') { this.toOrbit = false; this.map?.stopCameraAnimation?.(); }
    this.label();
  },
  play() {
    this.paused = false; this.userPaused = false;
    if (this.mode === '3d' && this.visible) this.approach();
    this.label();
  },
  onVisible(v) {
    this.visible = v;
    if (!this.map) return;
    if (!v && !this.paused && this.mode === '3d') { this.map.stopCameraAnimation?.(); this.toOrbit = false; }
    if (v && !this.paused && this.mode === '3d') this.approach();
  },
};

// ================================================================ 2. MAP + NEARBY
const near = { cat: 'school', map: null, g: null, markers: [], items: [], status: 'idle', source: 'none', exact: false, seq: 0 };
const cache = new Map();    // `${cat}|${lang}` → items — this page view only

function renderChips() {
  const host = $('#gmxChips'); if (!host) return;
  host.innerHTML = CATS.map(c => `<label class="chip"><input type="radio" name="gmxCat" value="${c.id}" ${c.id === near.cat ? 'checked' : ''}><span>${esc(mt('cat.' + c.id))}</span></label>`).join('');
}
function renderList() {
  const list = $('#gmxList'), note = $('#gmxNote'), attr = $('#gmxAttr'); if (!list) return;
  if (near.status === 'loading') { list.innerHTML = `<li class="gmx-msg">${esc(mt('near.loading'))}</li>`; }
  else if (!near.items.length) { list.innerHTML = near.status === 'idle' ? '' : `<li class="gmx-msg">${esc(mt('near.empty', { d: fmtDist(radiusOf(near.cat)) }))}</li>`; }
  else {
    list.innerHTML = near.items.map((it, i) => {
      const w = it.walk != null ? it.walk : estWalk(it.d), dr = it.drive != null ? it.drive : estDrive(it.d), ap = it.walk != null ? '' : '≈ ';
      const showWalk = it.d <= 3500;
      return `<li class="gmx-it" data-i="${i}">
        <button type="button" class="gmx-it-b" data-i="${i}"><span class="gmx-n" aria-hidden="true">${i + 1}</span>
          <span class="gmx-it-t"><span class="gmx-name" dir="auto">${esc(it.name)}</span>${it.sub ? `<span class="gmx-sub" dir="auto">${esc(it.sub)}</span>` : ''}
          <span class="gmx-meta"><b>${esc(fmtDist(it.d))}</b>${showWalk ? `<span>${esc(ap + mt('near.walk', { n: w }))}</span>` : ''}<span>${esc(ap + mt('near.drive', { n: dr }))}</span></span></span></button>
        <a class="gmx-route" href="${esc(LINKS.route(it.ll, it.placeId, showWalk ? 'walking' : 'driving'))}" target="_blank" rel="noopener">${esc(mt('near.route'))}</a>
      </li>`;
    }).join('');
  }
  if (note) note.textContent = near.source === 'curated' ? `${mt('near.curated')} ${mt('near.noteEst')}` : near.exact ? mt('near.noteExact') : mt('near.noteEst');
  if (attr) attr.hidden = near.source !== 'google';
}
const radiusOf = id => CATS.find(c => c.id === id)?.radius || MAPS.RADIUS || 1500;

function curated(cat) {
  const c = CATS.find(x => x.id === cat);
  return POIS.filter(c.cur).map(p => { const ll = { lat: p.ll[0], lng: p.ll[1] }; return { name: poiName(p), sub: '', ll, d: metres(HERE, ll), placeId: '' }; })
    .sort((a, b) => a.d - b.d).slice(0, 10);
}

async function searchGoogle(cat) {
  const c = CATS.find(x => x.id === cat);
  if (!c.types) return null;                 // «river & centre» is a fixed list of landmarks
  const { Place, SearchNearbyRankPreference } = await lib('places');
  const { places } = await Place.searchNearby({
    fields: ['id', 'displayName', 'location', 'formattedAddress', 'googleMapsURI', 'primaryTypeDisplayName'],
    locationRestriction: { center: HERE, radius: radiusOf(cat) },
    includedPrimaryTypes: c.types, maxResultCount: Math.min(20, MAPS.MAX_RESULTS || 8),
    rankPreference: SearchNearbyRankPreference?.DISTANCE ?? 'DISTANCE', language: GMAPS_LANG[lang] || 'uk', region: 'ua',
  });
  return (places || []).map(p => {
    const ll = { lat: p.location.lat(), lng: p.location.lng() };
    return { name: p.displayName || '', sub: p.primaryTypeDisplayName || '', ll, d: metres(HERE, ll), placeId: p.id, url: p.googleMapsURI };
  }).sort((a, b) => a.d - b.d);
}
async function routeTimes(items) {
  if (!MAPS.ROUTE_TIMES || !items.length) return false;
  const { RouteMatrix } = await lib('routes');
  const dests = items.map(i => i.ll);
  const run = async mode => (await RouteMatrix.computeRouteMatrix({ origins: [HERE], destinations: dests, travelMode: mode, fields: ['durationMillis', 'condition'] })).matrix.rows[0].items;
  const [w, d] = await Promise.all([run('WALKING'), run('DRIVING')]);
  items.forEach((it, i) => {
    if (w[i]?.durationMillis != null) it.walk = Math.max(1, Math.round(w[i].durationMillis / 60000));
    if (d[i]?.durationMillis != null) it.drive = Math.max(1, Math.round(d[i].durationMillis / 60000));
  });
  return true;
}

async function loadCat(cat) {
  const seq = ++near.seq, key = `${cat}|${lang}`;
  near.cat = cat; near.status = 'loading'; renderList();
  let items = cache.get(key), source = items ? cache.get(key + '#src') : null, exact = !!cache.get(key + '#exact');
  if (!items) {
    try {
      if (!near.g || authFailed) throw new Error('no google');
      items = await searchGoogle(cat); source = 'google';
      if (items == null || !items.length) { items = curated(cat); source = 'curated'; }
      else { try { exact = await routeTimes(items); } catch (e) { exact = false; } }
    } catch (e) {
      if (near.g) console.info('[maps] nearby search fell back to the curated list:', e?.message || e);
      items = curated(cat); source = 'curated';
    }
    cache.set(key, items); cache.set(key + '#src', source); cache.set(key + '#exact', exact);
  }
  if (seq !== near.seq) return;
  near.items = items; near.source = source; near.exact = exact; near.status = 'done';
  renderList(); drawMarkers();
}

// HTML markers on the 2D map (OverlayView — no Map ID needed)
function htmlMarker(el, ll) {
  const g = near.g, OV = g.OverlayView;
  class HM extends OV {
    onAdd() { this.getPanes().overlayMouseTarget.append(el); }
    draw() { const p = this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(ll)); if (p) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; } }
    onRemove() { el.remove(); }
  }
  const m = new HM(); m.setMap(near.map); return m;
}
function drawMarkers() {
  if (!near.map) return;
  near.markers.forEach(m => m.setMap(null)); near.markers = [];
  const b = new near.g.LatLngBounds(); b.extend(HERE);
  near.items.forEach((it, i) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'gmx-dot'; el.textContent = String(i + 1); el.title = it.name; el.dataset.i = i;
    el.addEventListener('click', e => { e.stopPropagation(); focusItem(i, false); });
    near.markers.push(htmlMarker(el, it.ll)); b.extend(it.ll);
  });
  if (near.items.length) near.map.fitBounds(b, 48); else near.map.panTo(HERE);
}
function focusItem(i, pan = true) {
  root.querySelectorAll('.gmx-it.on, .gmx-dot.on').forEach(el => el.classList.remove('on'));
  root.querySelector(`.gmx-it[data-i="${i}"]`)?.classList.add('on');
  document.querySelector(`.gmx-dot[data-i="${i}"]`)?.classList.add('on');
  const it = near.items[i]; if (!it) return;
  if (pan && near.map) near.map.panTo(it.ll);
  if (!pan) root.querySelector(`.gmx-it[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
}

const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#1b1813' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a89f8e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0a08' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3a3328' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#211d17' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f2a1d' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c271f' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#14120e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a3d27' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#c9b893' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#29241c' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#c9a96a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1a1f' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5d7b80' }] },
];

async function startNearby() {
  try {
    const g = await loadGoogle(); if (authFailed) throw new Error('auth');
    const { Map } = await lib('maps');
    near.g = g;
    const host = $('#gmxMap');
    near.map = new Map(host, {
      center: HERE, zoom: 15, clickableIcons: false, gestureHandling: 'cooperative', streetViewControl: false,
      mapTypeControl: true, fullscreenControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] },
      ...(MAPS.MAP_ID ? { mapId: MAPS.MAP_ID } : { styles: DARK, backgroundColor: '#0b0a08' }),
    });
    const pin = document.createElement('div');
    pin.className = 'gmx-pin';
    pin.innerHTML = `<img src="assets/maps/pin.svg" alt="" width="40" height="51"><span class="gmx-pin-l"><b>${esc(mt('map.you'))}</b><small>${esc(mt('map.addr'))}</small></span>`;
    near.pinEl = pin; htmlMarker(pin, HERE);
    root.classList.add('gmx-map-live');
    authWatch.add(() => mapOff());
  } catch (e) {
    mapOff();
  }
  await loadCat(near.cat);
}
function mapOff() {
  const wasLive = !!near.map;
  near.g = null; near.map = null; near.markers = []; root.classList.remove('gmx-map-live'); root.classList.add('gmx-map-off');
  cache.clear();
  if (wasLive && near.status !== 'idle') loadCat(near.cat);   // the key was refused after the map came up: curated list
}

// ================================================================ 4. STREET VIEW
const sv = { date: '' };
async function startStreetView() {
  const box = $('#gmxSv'); if (!box) return;
  try {
    if (authFailed) return;
    const { StreetViewService, StreetViewPanorama, StreetViewPreference, StreetViewSource } = await lib('streetView');
    const svc = new StreetViewService();
    const { data } = await svc.getPanorama({ location: HERE, radius: 120, preference: StreetViewPreference?.NEAREST ?? 'nearest', sources: [StreetViewSource?.OUTDOOR ?? 'outdoor'] });
    const loc = data?.location; if (!loc?.pano) return;
    const from = { lat: loc.latLng.lat(), lng: loc.latLng.lng() };
    box.hidden = false;
    new StreetViewPanorama($('#gmxPano'), {
      pano: loc.pano, pov: { heading: bearing(from, HERE), pitch: 6 }, zoom: 0.6,
      addressControl: false, motionTracking: false, motionTrackingControl: false, linksControl: true, panControl: false,
      fullscreenControl: true, enableCloseButton: false, showRoadLabels: true,
    });
    if (data.imageDate) { sv.date = data.imageDate; $('#gmxSvDate').textContent = mt('sv.date', { d: sv.date }); }
  } catch (e) { box.hidden = true; }   // no coverage (ZERO_RESULTS), no key, offline: the block stays hidden
}

// ================================================================ boot
function boot() {
  root = $('#gmaps'); if (!root) return;
  applyTexts();
  root.addEventListener('change', e => { if (e.target.name === 'gmxCat') loadCat(e.target.value); });
  root.addEventListener('click', e => {
    const b = e.target.closest('.gmx-it-b'); if (b) focusItem(+b.dataset.i, true);
    if (e.target.closest('#gmxFlyBtn')) fly.paused ? fly.play() : fly.pause(true);
  });
  onLangChange(() => { applyTexts(); if (near.status !== 'idle') loadCat(near.cat); });
  authWatch.add(() => { if (fly.state !== 'poster') fly.off(); $('#gmxSv').hidden = true; });

  const go = () => { fly.start(); startNearby().then(startStreetView); };
  if (!('IntersectionObserver' in window)) { fly.visible = true; go(); return; }
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '400px 0px' });
  io.observe(root);
  const vis = new IntersectionObserver(es => es.forEach(e => fly.onVisible(e.isIntersecting)), { threshold: 0.15 });
  vis.observe($('#gmxFly'));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
