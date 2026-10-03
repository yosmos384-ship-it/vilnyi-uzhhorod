// ЖК VILNYI (Uzhhorod) — "360° around the project": a panoramic view captured from the real 3D scene (camera PANO_EYE_H m
// above the courtyard; faces pre-rendered by tools/pano-capture.html into assets/panorama/<mode>-<size>/) with every point
// of interest pinned at its true bearing and ground distance, a north-up "radar" mini-map synced to the heading,
// category filters, and Google-Maps routes from the project.
// Self-contained: bootstraps itself on #around. The section and its nav link (.nav-360) are hidden by css/panorama.css
// until this module switches them on: PROJECT.features.pano360 === 'auto' → only when the first cube face loads;
// 'map' → at once, as a flat north-up map (radar + list + cards, no cube, no WebGL); false → never.
// WebGL starts lazily when the section approaches the viewport; three.js is imported only then.
import { bearingOf, dirOfBearing, PROJECT, BUILDINGS, B_IDS, SITE_CENTER, roofY, buildingCenter } from './data.js';
import * as DATA from './data.js';                       // optional helpers (llToWorld, PODIUM) — absent names are just undefined
import { lang, onLangChange } from './i18n.js';
import { pt, poiName, poiLine, dirName, CARD } from './i18n-panorama.js';

// ---------------------------------------------------------------- geometry of the capture (shared with the capture page)
// 120 m above the courtyard centre (grade = y 0): about twice the height of the tallest tower (17 floors, top ≈ 58 m), so
// the four roofs lie 55–75° below the horizon and never hide a place; a point 1 km away sits 6.8° below the horizon.
export const PANO_EYE_H = 120;
export const PANO_EYE = [SITE_CENTER[0], PANO_EYE_H, SITE_CENTER[1]];   // world x,y,z
// The baked faces in assets/panorama/ are only valid for the massing and the eye they were captured with: if the
// buildings or SITE_CENTER change, re-run the capture. (Kept as a function: the capture page compares it with PANO_EYE.)
export function siteCentre() { return [SITE_CENTER[0], SITE_CENTER[1]]; }
// "You are here" anchors: the centre of each tower's roof (world x,y,z) — always from data.js
export const PROJECT_ANCHORS = B_IDS.map(id => {
  const [x, z] = buildingCenter(id);
  return { id: id.toLowerCase(), no: BUILDINGS[id].no, name: String(BUILDINGS[id].no), world: [x, roofY(id), z] };
});
// Cube faces: capture camera looks along dir with the given up vector; the viewer rebuilds the same orientation.
export const PANO_FACES = [
  { id: 'px', dir: [1, 0, 0], up: [0, 1, 0] }, { id: 'nx', dir: [-1, 0, 0], up: [0, 1, 0] },
  { id: 'pz', dir: [0, 0, 1], up: [0, 1, 0] }, { id: 'nz', dir: [0, 0, -1], up: [0, 1, 0] },
  { id: 'py', dir: [0, 1, 0], up: [0, 0, -1] }, { id: 'ny', dir: [0, -1, 0], up: [0, 0, 1] },
];
// WHAT HAS BEEN CAPTURED. A browser logs every request for a missing file as a console error, whatever asks for it, so the
// module never probes for faces on a production page: it trusts this record. The capture task (tools/pano-capture.html)
// sets `ready: true` after writing the faces and lists exactly the lights and sizes it produced (both sizes are expected;
// one light alone is fine — the day/dusk switch then hides). While `ready` is false the section and its nav link stay
// hidden and nothing is requested. `?pano=probe` (dev pages) ignores the record and tests for the first face instead.
export const PANO_CAPTURE = { ready: true, modes: ['day', 'dusk'], sizes: [1536, 1024] };   // T33: captured 2026-10-03 (tools/pano-capture.py)
const PROBE = (() => { try { return new URLSearchParams(location.search).get('pano') === 'probe'; } catch (e) { return false; } })();
const ALL_MODES = ['day', 'dusk'];
const MODES = PROBE ? ALL_MODES : ALL_MODES.filter(m => PANO_CAPTURE.modes.includes(m));
export const PANO_SIZES = PROBE ? [1536, 1024] : [1536, 1024].filter(n => PANO_CAPTURE.sizes.includes(n));
const firstMode = () => { const m = lsGet('vrc.panoMode'); return MODES.includes(m) ? m : MODES.includes('dusk') ? 'dusk' : MODES[0]; };
export const faceUrl = (mode, size, id) => `assets/panorama/${mode}-${size}/${id}.jpg`;

// ---------------------------------------------------------------- the project on the map
// Centre of the plot, verified on OpenStreetMap (data/pois.json → project; notes/W4-surroundings.md): 48.61133 N, 22.27685 E.
export const PROJECT_LL = [PROJECT?.geo?.lat ?? 48.61133, PROJECT?.geo?.lon ?? 22.27685];

// ---------------------------------------------------------------- points of interest (real coordinates)
// Embedded copy of data/pois.json (45 places; sources per place are in that file and in notes/W4-surroundings.md) plus the
// on-site children's play centre from the plans. cat: transport | shopping | education | health | parks | leisure | city.
// kind → i18n 'k.<kind>'.  key:true = priority label.  approx:true = position not exact (shown on the card).
// name: uk + en here; he/ro/de/fr/it/ru in i18n-panorama.js.  Distances and bearings are NOT stored — computed below.
export const POIS = [
  // --- transport
  { id: 'stop-hrushevskoho', cat: 'transport', kind: 'bus', name: { uk: 'Зупинка на вул. Грушевського', en: 'Bus stop on Hrushevskoho St' }, route: '24', ll: [48.611689, 22.277672], approx: true, key: true }, // position from plans p.5; stop name not confirmed; route 24 (suspilne.media, 27.08.2025)
  { id: 'bus-station', cat: 'transport', kind: 'busstation', name: { uk: 'Автовокзал «Ужгород-1»', en: 'Uzhhorod-1 bus station' }, ll: [48.60953, 22.29807] },
  { id: 'rail', cat: 'transport', kind: 'rail', name: { uk: 'Залізничний вокзал Ужгород', en: 'Uzhhorod railway station' }, line: { uk: 'Укрзалізниця', en: 'Ukrzaliznytsia' }, ll: [48.609369, 22.301134], key: true },
  { id: 'airport', cat: 'transport', kind: 'airport', name: { uk: 'Аеропорт «Ужгород» · UDJ', en: 'Uzhhorod Airport · UDJ' }, ll: [48.63417, 22.26333], note: 'note.airport' }, // passenger flights suspended since 24.02.2022 — never advertised
  { id: 'border-sk', cat: 'transport', kind: 'border', name: { uk: 'КПП «Ужгород» – Вишнє Нємецьке (Словаччина)', en: 'Uzhhorod – Vyšné Nemecké (Slovakia)' }, ll: [48.65377, 22.26586], key: true },
  { id: 'border-hu', cat: 'transport', kind: 'border', name: { uk: 'Чоп · КПП «Тиса» – Захонь (Угорщина)', en: 'Chop · Tysa – Záhony (Hungary)' }, ll: [48.43056, 22.2], approx: true, note: 'note.border-hu' }, // coordinate of the town of Chop
  // --- shopping
  { id: 'onsite-market', cat: 'shopping', kind: 'supermarket', name: { uk: 'Супермаркет у комплексі', en: 'On-site supermarket' }, ll: PROJECT_LL, onSite: 'supermarket', key: true },
  { id: 'palladium', cat: 'shopping', kind: 'mall', name: { uk: 'ТЦ «Палладіум»', en: 'Palladium shopping centre' }, ll: [48.61218, 22.27732], approx: true },
  { id: 'zina', cat: 'shopping', kind: 'shop', name: { uk: 'Зіна', en: 'Zina' }, ll: [48.611412, 22.278225], key: true },
  { id: 'tc-novyi', cat: 'shopping', kind: 'mall', name: { uk: 'ТЦ «Новий»', en: 'Novyi shopping centre' }, ll: [48.60774, 22.27112], key: true },
  { id: 'vopak', cat: 'shopping', kind: 'supermarket', name: { uk: 'Вопак', en: 'Vopak' }, ll: [48.607796, 22.270795] },
  { id: 'silpo', cat: 'shopping', kind: 'supermarket', name: { uk: 'Сільпо', en: 'Silpo' }, ll: [48.612589, 22.266777], key: true },
  { id: 'tokio', cat: 'shopping', kind: 'mall', name: { uk: 'ТРЦ «Токіо» · кінотеатр «5 елемент»', en: 'Tokio mall · 5th Element cinema' }, ll: [48.60866, 22.26739], approx: true },
  { id: 'atb', cat: 'shopping', kind: 'supermarket', name: { uk: 'АТБ-маркет', en: 'ATB-Market' }, ll: [48.604549, 22.275683], key: true },
  { id: 'velmart', cat: 'shopping', kind: 'hyper', name: { uk: 'Велмарт', en: 'Velmart' }, ll: [48.61159, 22.26091], key: true },
  { id: 'epicentr', cat: 'shopping', kind: 'hyper', name: { uk: 'Епіцентр К', en: 'Epicentr K' }, ll: [48.613716, 22.260893] },
  { id: 'market', cat: 'shopping', kind: 'market', name: { uk: '«П\'яний базар»', en: '"Pianyi Bazar" market' }, ll: [48.60263, 22.289303], approx: true },
  // --- education
  { id: 'zdo8', cat: 'education', kind: 'kinder', name: { uk: 'ЗДО №8 «Дзвіночок»', en: 'Kindergarten No. 8 "Dzvinochok"' }, ll: [48.61023, 22.281], key: true },
  { id: 'zdo12', cat: 'education', kind: 'kinder', name: { uk: 'ЗДО №12', en: 'Kindergarten No. 12' }, ll: [48.61413, 22.27975] },
  { id: 'lyceum12', cat: 'education', kind: 'highschool', name: { uk: 'Ужгородський ліцей №12', en: 'Uzhhorod Lyceum No. 12' }, ll: [48.61068, 22.28382], key: true },
  { id: 'lyceum-imidzh', cat: 'education', kind: 'highschool', name: { uk: 'Ліцей «Імідж» (школа №19)', en: 'Lyceum "Imidzh" (School No. 19)' }, ll: [48.60984, 22.27019] },
  { id: 'lyceum15', cat: 'education', kind: 'highschool', name: { uk: 'Ужгородський ліцей №15', en: 'Uzhhorod Lyceum No. 15' }, ll: [48.61187, 22.28509] },
  { id: 'zdo42', cat: 'education', kind: 'kinder', name: { uk: 'ЗДО №42 «Джерельце»', en: 'Kindergarten No. 42 "Dzhereltse"' }, ll: [48.60927, 22.26893] },
  { id: 'uzhnu', cat: 'education', kind: 'university', name: { uk: 'Ужгородський національний університет', en: 'Uzhhorod National University' }, ll: [48.63553, 22.29008], key: true },
  // --- health
  { id: 'prevention', cat: 'health', kind: 'clinic', name: { uk: 'Клініка Prevention', en: 'Prevention clinic' }, ll: [48.607366, 22.281371], key: true },
  { id: 'pharmacy', cat: 'health', kind: 'pharmacy', name: { uk: 'Аптека «Хустфарм»', en: 'Khustpharm pharmacy' }, ll: [48.607503, 22.27096] },
  { id: 'amb4', cat: 'health', kind: 'clinic', name: { uk: 'Амбулаторія №4', en: 'Outpatient clinic No. 4' }, ll: [48.61317, 22.286188] },
  { id: 'child-clinic', cat: 'health', kind: 'clinic', name: { uk: 'Міська дитяча поліклініка', en: 'City children\'s polyclinic' }, ll: [48.601178, 22.282315] },
  { id: 'reg-hospital', cat: 'health', kind: 'hospital', name: { uk: 'Обласна клінічна лікарня ім. А. Новака', en: 'Zakarpattia Regional Clinical Hospital' }, ll: [48.62009, 22.29055], key: true },
  { id: 'city-hospital', cat: 'health', kind: 'hospital', name: { uk: 'Міська багатопрофільна клінічна лікарня', en: 'City multidisciplinary clinical hospital' }, ll: [48.60026, 22.28613] },
  // --- parks & water
  { id: 'peremohy', cat: 'parks', kind: 'park', name: { uk: 'Парк Перемоги', en: 'Peremohy (Victory) Park' }, ll: [48.6113, 22.28779] },
  { id: 'uzh', cat: 'parks', kind: 'river', name: { uk: 'Річка Уж', en: 'Uzh river' }, ll: [48.62, 22.2782], key: true },
  { id: 'bozdosh', cat: 'parks', kind: 'park', name: { uk: 'Боздоський парк', en: 'Bozdosh Park' }, ll: [48.62208, 22.26802], key: true },
  { id: 'linden', cat: 'parks', kind: 'park', name: { uk: 'Липова алея · набережна Незалежності', en: 'Linden Alley · Nezalezhnosti embankment' }, ll: [48.62409, 22.28956], key: true },
  { id: 'botanic', cat: 'parks', kind: 'garden', name: { uk: 'Ботанічний сад УжНУ', en: 'UzhNU Botanical Garden' }, ll: [48.61993, 22.30499] },
  // --- leisure & sport
  { id: 'onsite-spa', cat: 'leisure', kind: 'pool', name: { uk: 'VILNYI SPA · фітнес і басейн', en: 'VILNYI SPA · fitness & pool' }, ll: PROJECT_LL, onSite: 'fitness', key: true },
  { id: 'onsite-playland', cat: 'leisure', kind: 'playland', name: { uk: 'Дитячий ігровий центр у комплексі', en: 'On-site children\'s play centre' }, ll: PROJECT_LL, onSite: 'supermarket' }, // plans: playland in the commercial podium (not in pois.json)
  { id: 'avtomobilist', cat: 'leisure', kind: 'stadium', name: { uk: 'Стадіон «Автомобіліст»', en: 'Avtomobilist football pitch' }, ll: [48.61429, 22.27209] },
  { id: 'yunist', cat: 'leisure', kind: 'gym', name: { uk: 'Спорткомплекс «Юність»', en: 'Yunist sports complex' }, ll: [48.61271, 22.28948] },
  { id: 'avangard', cat: 'leisure', kind: 'stadium', name: { uk: 'Стадіон «Авангард»', en: 'Avanhard Stadium' }, ll: [48.62378, 22.27742], key: true },
  { id: 'theatre', cat: 'leisure', kind: 'theatre', name: { uk: 'Закарпатський музично-драматичний театр', en: 'Zakarpattia Music and Drama Theatre' }, ll: [48.62163, 22.2948], key: true },
  // --- city orientation
  { id: 'narodna', cat: 'city', kind: 'square', name: { uk: 'Площа Народна', en: 'Narodna Square' }, ll: [48.625229, 22.288217], key: true },
  { id: 'ped-bridge', cat: 'city', kind: 'square', name: { uk: 'Пішохідний міст · Театральна площа', en: 'Pedestrian bridge · Teatralna Square' }, ll: [48.62164, 22.29801] },
  { id: 'korzo', cat: 'city', kind: 'oldtown', name: { uk: 'Вулиця Корзо · старе місто', en: 'Korzo Street · Old Town' }, ll: [48.62342, 22.29845], key: true },
  { id: 'cathedral', cat: 'city', kind: 'landmark', name: { uk: 'Хрестовоздвиженський кафедральний собор', en: 'Holy Cross Cathedral' }, ll: [48.622912, 22.302313], key: true },
  { id: 'castle', cat: 'city', kind: 'landmark', name: { uk: 'Ужгородський замок', en: 'Uzhhorod Castle' }, ll: [48.62166, 22.30667], key: true },
];
export const CATS = ['transport', 'shopping', 'education', 'health', 'parks', 'leisure', 'city'];
// Centre line of the Uzh (OpenStreetMap waterway, ±8 m; data/surroundings.json → river.polyline), east → west — drawn on the radar.
export const RIVER_LL = [[48.618, 22.31], [48.6178, 22.3096], [48.6176, 22.3092], [48.6175, 22.3086], [48.6175, 22.3077], [48.6175, 22.3068], [48.618, 22.3048], [48.619, 22.303],
  [48.6203, 22.3009], [48.6212, 22.2992], [48.6218, 22.2975], [48.6219, 22.2972], [48.6224, 22.2956], [48.6229, 22.2934], [48.6232, 22.2918], [48.6234, 22.29], [48.6233, 22.2886],
  [48.623, 22.2874], [48.6229, 22.287], [48.6224, 22.2856], [48.6218, 22.2837], [48.6201, 22.2793], [48.62, 22.2782], [48.6202, 22.2739], [48.6208, 22.2731], [48.6219, 22.2723],
  [48.6233, 22.2724], [48.6242, 22.272], [48.6256, 22.2704], [48.6267, 22.2687], [48.627, 22.2671], [48.6268, 22.2661], [48.6244, 22.2637], [48.6231, 22.2622], [48.6229, 22.2621],
  [48.62, 22.2591], [48.6196, 22.2584], [48.6193, 22.2576], [48.6184, 22.2555], [48.618, 22.2551], [48.6162, 22.2544], [48.6153, 22.2545], [48.6145, 22.2548], [48.6123, 22.2539]];

// ---------------------------------------------------------------- distances & times
const R_EARTH = 6371008.8, RAD = Math.PI / 180;
export function haversine([la1, lo1], [la2, lo2]) {
  const a = Math.sin((la2 - la1) * RAD / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin((lo2 - lo1) * RAD / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function trueBearing([la1, lo1], [la2, lo2]) {
  const y = Math.sin((lo2 - lo1) * RAD) * Math.cos(la2 * RAD);
  const x = Math.cos(la1 * RAD) * Math.sin(la2 * RAD) - Math.sin(la1 * RAD) * Math.cos(la2 * RAD) * Math.cos((lo2 - lo1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
// Estimates for a compact city. Route length = straight line × 1.3. Walking 4.8 km/h. Driving: 2 min to get going, then the
// first 2 km of the route at 24 km/h (district streets), the next 4 km at 33 km/h (main streets), the rest at 60 km/h (the
// road to the border); one continuous curve, so a farther place never gets a shorter time.
const DETOUR = 1.3;
const walkMin = d => Math.max(1, Math.round(d * DETOUR / 80));
const driveMin = d => { const r = d * DETOUR; return Math.max(2, Math.round(2 + Math.min(r, 2000) / 400 + Math.min(Math.max(r - 2000, 0), 4000) / 550 + Math.max(r - 6000, 0) / 1000)); };
const WALKABLE = 1200;                                    // ≤ ~20 min on foot → turquoise
const WALK_ROUTE_MAX = 3000;                              // a walking route is offered up to here (the old town is ~2 km away)
// World position: geographic → site frame through data.js (true north = COMPASS.negZ). The eye stands over the courtyard
// centre, ~12 m from the plot centre the distances are measured from, so pins are aimed from the EYE (it matters for
// places within ~200 m) while the distance and direction shown in text are from the project point.
const M_LAT = 111320, M_LON = 111320 * Math.cos(PROJECT_LL[0] * RAD);
function worldOf(ll) {
  if (typeof DATA.llToWorld === 'function') { try { const w = DATA.llToWorld(ll[0], ll[1]); if (Number.isFinite(w?.[0]) && Number.isFinite(w?.[1])) return w; } catch (e) { /* fall through */ } }
  const e = (ll[1] - PROJECT_LL[1]) * M_LON, n = (ll[0] - PROJECT_LL[0]) * M_LAT, d = Math.hypot(e, n);
  const [dx, dz] = dirOfBearing(Math.atan2(e, n) / RAD);
  return [PANO_EYE[0] + dx * d, PANO_EYE[2] + dz * d];
}
const onSiteBuilding = kind => { try { return (DATA.PODIUM || []).find(q => q.kind === kind)?.building || null; } catch (e) { return null; } };
for (const p of POIS) {
  p.dist = p.onSite ? 0 : haversine(PROJECT_LL, p.ll);
  p.bearing = p.onSite ? 0 : trueBearing(PROJECT_LL, p.ll);
  p.walk = walkMin(p.dist); p.drive = driveMin(p.dist);
  p.mode = p.dist <= WALKABLE ? 'walk' : 'drive';
  if (p.onSite) { p.b = onSiteBuilding(p.onSite); continue; }
  const [wx, wz] = worldOf(p.ll), dx = wx - PANO_EYE[0], dz = wz - PANO_EYE[2];
  p.eye = { dx, dz, dist: Math.hypot(dx, dz), bearing: bearingOf(dx, dz) };
}
// First look: towards the city centre (Narodna Square — north-north-east, over the river), not towards the street corner.
const FIRST_BEARING = Math.round(POIS.find(p => p.id === 'narodna')?.bearing ?? 30);

// ---------------------------------------------------------------- icons
const I = {
  transport: '<rect x="5" y="3.5" width="14" height="14" rx="3"/><path d="M5 11h14M8.5 14.5h.01M15.5 14.5h.01M8 20.5l1.5-3M16 20.5l-1.5-3"/>',
  rail: '<rect x="6" y="3.5" width="12" height="13" rx="2.5"/><path d="M6 10.5h12M9 13.8h.01M15 13.8h.01M8.5 20.5l2-3.5M15.5 20.5l-2-3.5"/>',
  bus: '<rect x="5" y="3.5" width="14" height="14" rx="2"/><path d="M5 12h14M8 20v-2.5M16 20v-2.5M8.5 15h.01M15.5 15h.01M9 6.5h6"/>',
  airport: '<path d="M21 15.5l-8-5V4.8a1.5 1.5 0 0 0-3 0v5.7l-8 5v2l8-2.4v4.4l-2.2 1.6v1.4L11.5 21l3.7 1.5v-1.4L13 19.5v-4.4l8 2.4z"/>',
  shopping: '<path d="M5 8h14l-1.2 12.5H6.2zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  education: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14zM6.5 11.5v4.5c3.3 2.4 7.7 2.4 11 0v-4.5M21.5 9.5v5.5"/>',
  health: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
  parks: '<path d="M12 21v-6M12 15c-3.6 0-6-2.3-6-5.3C6 6.4 8.7 3.5 12 3.5s6 2.9 6 6.2c0 3-2.4 5.3-6 5.3zM8 21h8"/>',
  river: '<path d="M3 8c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0M3 12.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0M3 17c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>',
  border: '<path d="M5 20.5V8M3 20.5h4M5 10.5h15.5M5 13.5h15.5M9 10.5l2 3M13 10.5l2 3M17 10.5l2 3M20.5 10.5v3"/><circle cx="5" cy="6" r="2"/>',
  leisure: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  stadium: '<ellipse cx="12" cy="12" rx="9" ry="5.5"/><ellipse cx="12" cy="12" rx="4.5" ry="2.3"/><path d="M12 6.5v11"/>',
  city: '<path d="M3.5 20.5h17M5 20.5V10.5M9 20.5V10.5M15 20.5V10.5M19 20.5V10.5M3.5 10.5h17L12 4z"/>',
  kinder: '<path d="M4 20V10l8-6 8 6v10zM9.5 20v-5h5v5"/><circle cx="12" cy="10.5" r="1.3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  unfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  gyro: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M3 9a9 9 0 0 0 0 6M21 9a9 9 0 0 1 0 6M11 18.5h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2.2-6.5L15 17v4M8 12.5l1.5-4.5 3.5-1 2 3.5 2.5 1.5M12.2 14.5l1-4.5"/>',
  car: '<path d="M4 16.5V12l2-5h12l2 5v4.5zM4 16.5V19M20 16.5V19M4 12h16"/><circle cx="7.5" cy="14.3" r=".8"/><circle cx="16.5" cy="14.3" r=".8"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  dusk: '<path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 7v2.5M5.5 10.5l1.6 1.2M18.5 10.5l-1.6 1.2M8 20.5h8"/>',
  drag: '<path d="M8 12h8M4.5 12l3-3M4.5 12l3 3M19.5 12l-3-3M19.5 12l-3 3"/>',
};
const KIND_ICON = { rail: 'rail', bus: 'bus', busstation: 'bus', airport: 'airport', border: 'border', river: 'river', stadium: 'stadium', kinder: 'kinder', playland: 'kinder' };
const svg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[k] || ''}</svg>`;
const iconOf = p => KIND_ICON[p.kind] || p.cat;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- formatting
function fmtDist(d, approx) {
  if (d < 1) return pt('onsite');
  if (approx) return '≈ ' + fmtDist(d);
  const U = CARD[lang] || CARD.en;
  if (d < 1000) return `${Math.round(d / 10) * 10} ${U.m}`;
  const km = d < 10000 ? (Math.round(d / 100) / 10) : Math.round(d / 1000);
  let s = String(km); if (U.comma) s = s.replace('.', ',');
  return `${s} ${U.km}`;
}
const fmtMin = n => pt('min', { n });
const nameOf = p => poiName(p);
const distOf = p => fmtDist(p.dist, p.approx);
const kindLine = p => { const l = poiLine(p); return `${esc(pt('k.' + p.kind))}${l ? ` · <span dir="auto">${esc(l)}</span>` : ''}`; };
export function mapsDir(p, mode) {
  const o = PROJECT_LL.join(','), d = p.ll.join(',');
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${mode === 'walk' ? 'walking' : 'driving'}`;
}
export const mapsOpen = p => `https://www.google.com/maps/search/?api=1&query=${p.ll.join(',')}`;

// ---------------------------------------------------------------- radar scale (piecewise, rings evenly spaced)
const RINGS = [500, 1000, 2000, 5000];
function radarR(d) {
  if (d <= 500) return d / 500 * 22;
  if (d <= 1000) return 22 + (d - 500) / 500 * 22;
  if (d <= 2000) return 44 + (d - 1000) / 1000 * 22;
  if (d <= 5000) return 66 + (d - 2000) / 3000 * 22;
  return Math.min(95, 88 + (d - 5000) / 9000 * 7);
}
const polar = (b, r) => [Math.sin(b * RAD) * r, -Math.cos(b * RAD) * r];

// ================================================================ bootstrap
const $ = (s, r = document) => r.querySelector(s);
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } };

// Visibility. css/panorama.css keeps #around and .nav-360 hidden until `html.has-pano` / `#around.is-on` are set here, so
// nothing flashes and a module that failed to load leaves no empty section behind.
//   false / 'off' → never shown.   'auto' (default) → shown only when the faces are recorded as captured (PANO_CAPTURE.ready)
//   and the first one really loads; not captured → hidden, nothing requested, console clean.
//   'map' → shown at once as the flat north-up map (no cube, no request).   true → shown; map mode if there are no faces.
// `?pano=auto|map|on|off|probe` overrides the flag for testing (probe = 'auto' that ignores PANO_CAPTURE and tests the file).
function panoFeature() {
  let f = PROJECT?.features?.pano360;
  try { const q = new URLSearchParams(location.search).get('pano'); if (q) f = q === 'on' ? true : q === 'off' ? false : q === 'probe' ? 'auto' : q; } catch (e) { /* no location */ }
  return f === undefined || f === null ? 'auto' : f;
}
const probeFace = url => new Promise(res => {
  try { const im = new Image(); im.onload = () => res(im.naturalWidth > 0); im.onerror = () => res(false); im.src = url; } catch (e) { res(false); }
});
function setShown(sec, on) {
  sec.classList.toggle('is-on', on); sec.hidden = !on;
  document.documentElement.classList.toggle('has-pano', on);
  document.querySelectorAll('.nav-360').forEach(a => { a.hidden = !on; });
}
async function boot() {
  const sec = document.getElementById('around');
  if (!sec || sec.dataset.ready) return;
  sec.dataset.ready = '1';
  try {
    const f = panoFeature();
    if (f === false || f === 'off' || f === 'false' || !document.getElementById('panoApp')) { setShown(sec, false); return; }
    let map = f === 'map';
    if (!map) {
      const have = (PROBE || PANO_CAPTURE.ready) && MODES.length > 0 && PANO_SIZES.length > 0;
      const ok = have && await probeFace(faceUrl(firstMode(), PANO_SIZES[PANO_SIZES.length - 1], PANO_FACES[0].id));
      if (!ok && f !== 'auto') map = true;
      else if (!ok) { setShown(sec, false); return; }                // 'auto' and nothing captured yet → the section stays hidden
    }
    setShown(sec, true);
    createPanorama(sec, { map });
    if (location.hash === '#around') requestAnimationFrame(() => sec.scrollIntoView());
  } catch (err) {
    console.warn('[panorama] section disabled:', err?.message || err);
    setShown(sec, false);
  }
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }

// ================================================================ the widget
function createPanorama(sec, opt = {}) {
  const app = $('#panoApp', sec);
  const S = {
    filter: 'all', sel: null, yaw: 0, pitch: -0.2, hfov: 0, mode: firstMode() || 'dusk',
    dirty: true, auto: !reduced, lastUser: 0, anim: null, gyro: null, listAll: false, full: false, map: !!opt.map,
  };
  let gl = null;           // { THREE, renderer, scene, camera, faces, … } once WebGL is up
  let W = 0, H = 0;

  // ---------- static DOM
  app.innerHTML = `
    <div class="pano-bar">
      <div class="pano-chips" role="toolbar" id="panoChips"></div>
      <div class="pano-legend" aria-hidden="true"><span class="lg is-walk"><i></i><b data-p="legend.walk"></b></span><span class="lg is-drive"><i></i><b data-p="legend.drive"></b></span></div>
    </div>
    <div class="pano-stage" id="panoStage" tabindex="0" role="application">
      <div class="pano-gl"></div>
      <div class="pano-vignette" aria-hidden="true"></div>
      <div class="pano-pins" id="panoPins"></div>
      <div class="pano-compass" dir="ltr" aria-hidden="true"><div class="pc-strip"></div><div class="pc-mark"><i></i><b class="pc-deg"></b></div></div>
      <div class="pano-tools">
        <div class="pano-mode" role="group"${MODES.length > 1 ? '' : ' hidden'}>
          <button type="button" data-mode="day" class="pt-btn"${MODES.includes('day') ? '' : ' hidden'}>${svg('sun')}<span data-p="day"></span></button>
          <button type="button" data-mode="dusk" class="pt-btn"${MODES.includes('dusk') ? '' : ' hidden'}>${svg('dusk')}<span data-p="dusk"></span></button>
        </div>
        <button type="button" class="pt-btn pt-ic" data-act="gyro" hidden>${svg('gyro')}</button>
        <button type="button" class="pt-btn pt-ic pt-zoom" data-act="zin">${svg('plus')}</button>
        <button type="button" class="pt-btn pt-ic pt-zoom" data-act="zout">${svg('minus')}</button>
        <button type="button" class="pt-btn pt-ic" data-act="full">${svg('full')}</button>
      </div>
      <figure class="pano-radar" dir="ltr"><svg class="pr-svg" viewBox="-100 -100 200 200" role="img"></svg></figure>
      <div class="pano-hint" aria-hidden="true">${svg('drag')}<span></span></div>
      <div class="pano-veil"><img src="assets/brand/group-apple-touch-icon.png" alt="" width="64" height="64" onerror="this.remove()"><p class="pv-t"></p><div class="pv-bar"><i></i></div></div>
      <aside class="pano-card" id="panoCard" hidden aria-live="polite"></aside>
    </div>
    <div class="pano-foot">
      <p class="pano-note"></p>
      <div class="pano-list" id="panoList"></div>
      <button type="button" class="btn link pano-more" id="panoMore"></button>
    </div>`;
  const stage = $('#panoStage', app), pinsEl = $('#panoPins', app), card = $('#panoCard', app), radar = $('.pr-svg', app);
  const veil = $('.pano-veil', app), hint = $('.pano-hint', app), strip = $('.pc-strip', app), degEl = $('.pc-deg', app);
  const gyroBtn = $('[data-act="gyro"]', app), fullBtn = $('[data-act="full"]', app);
  // map mode: no cube and no WebGL — the radar becomes the stage (css .map-mode), the list and the cards work as usual
  function setMapMode() { S.map = true; S.auto = false; stage.classList.add('map-mode'); app.classList.add('is-map'); stage.classList.remove('loading'); veil.classList.add('gone'); }
  if (S.map) setMapMode();

  // compass strip: 2 turns of ticks, 4 px per degree, scrolled by the heading
  const PXD = 4;
  {
    let h = '';
    for (let d = -180; d <= 540; d += 5) {
      const b = ((d % 360) + 360) % 360, x = (d + 180) * PXD;
      const card4 = b % 90 === 0, card8 = b % 45 === 0;
      h += `<i class="t${card4 ? ' c4' : card8 ? ' c8' : b % 15 === 0 ? ' c15' : ''}" style="left:${x}px"></i>`;
      if (card8) h += `<b class="l${card4 ? ' c4' : ''}" data-b="${b}" style="left:${x}px"></b>`;
      else if (b % 15 === 0) h += `<em style="left:${x}px">${b}</em>`;
    }
    strip.innerHTML = h;
  }

  // pins
  const pinEls = new Map();
  const projPins = [
    ...POIS.filter(p => !p.onSite),
    // the project itself, seen when looking down (roof of each block's bar, from data.js)
    ...PROJECT_ANCHORS.map(a => ({ ...a, proj: true, cat: 'project' })),
  ];
  pinsEl.innerHTML = projPins.map(p => p.proj
    ? `<div class="pp pp-proj" data-id="${p.id}"><span class="pp-card"><span class="pp-tx"><b dir="auto" data-bld="${esc(p.name)}"></b><small data-p="here"></small></span></span><span class="pp-stem"></span><span class="pp-dot"></span></div>`
    : `<button type="button" class="pp is-${p.mode}${p.key ? ' key' : ''}" data-id="${p.id}" data-cat="${p.cat}"><span class="pp-card"><i class="pp-ic">${svg(iconOf(p))}</i><span class="pp-tx"><b dir="auto"></b><small></small></span></span><span class="pp-stem"></span><span class="pp-dot"></span></button>`).join('');
  // distance-ring tags (the rings themselves are drawn on the ground in WebGL; each tag rides its ring near the view centre)
  const GROUND_RINGS = [{ r: 500, c: 'walk' }, { r: 1000, c: 'walk' }, { r: 2000, c: 'drive' }];
  pinsEl.insertAdjacentHTML('afterbegin', GROUND_RINGS.map(g => `<span class="pp-ring is-${g.c}" data-r="${g.r}"></span>`).join(''));
  const ringTags = GROUND_RINGS.map(g => ({ ...g, el: pinsEl.querySelector(`[data-r="${g.r}"]`) }));
  for (const p of projPins) {
    const el = pinsEl.querySelector(`[data-id="${p.id}"]`);
    pinEls.set(p.id, { p, el, cardEl: el.querySelector('.pp-card'), w: 0, h: 0, dir: null });
  }

  // ---------- language-dependent text
  function renderText() {
    const rtl = lang === 'he';
    const head = (k, v) => { const el = sec.querySelector(`[data-pp="${k}"]`); if (el) el.textContent = v; };
    head('eyebrow', pt('eyebrow')); head('title', pt('title'));
    head('lead', S.map ? pt('leadMap') : pt('lead', { h: PANO_EYE_H }));
    app.querySelectorAll('[data-p]').forEach(el => { el.textContent = pt(el.dataset.p, { d: fmtDist(WALKABLE) }); });
    app.querySelectorAll('[data-bld]').forEach(el => { el.textContent = `${PROJECT?.nameLatin || 'VILNYI'} · ${pt('bld', { n: el.dataset.bld })}`; });
    stage.setAttribute('aria-label', pt(S.map ? 'mapLabel' : 'stageLabel'));
    $('.pano-mode', app).setAttribute('aria-label', pt('modeLabel'));
    $('[data-act="zin"]', app).setAttribute('aria-label', pt('zoomIn'));
    $('[data-act="zout"]', app).setAttribute('aria-label', pt('zoomOut'));
    fullBtn.setAttribute('aria-label', pt(S.full ? 'exitFull' : 'full'));
    gyroBtn.setAttribute('aria-label', pt(S.gyro ? 'gyroOff' : 'gyro'));
    radar.setAttribute('aria-label', pt(S.map ? 'mapLabel' : 'radar'));
    hint.querySelector('span').textContent = pt(coarse ? 'hintTouch' : 'hint');
    veil.querySelector('.pv-t').textContent = pt('loading');
    $('.pano-note', app).textContent = pt('note');
    strip.querySelectorAll('b.l').forEach(b => { b.textContent = dirName(+b.dataset.b, true); });
    for (const { p, el } of pinEls.values()) {
      if (p.proj) continue;
      el.querySelector('b').textContent = nameOf(p);
      el.querySelector('small').innerHTML = pinMeta(p);
      el.setAttribute('aria-label', `${nameOf(p)} — ${pt('k.' + p.kind)}, ${distOf(p)}`);
    }
    { const U = CARD[lang] || CARD.en; for (const g of ringTags) g.el.textContent = g.r < 1000 ? `${g.r} ${U.m}` : `${g.r / 1000} ${U.km}`; }
    for (const v of pinEls.values()) v.w = 0;     // re-measure
    renderChips(); renderRadar(); renderList();
    if (S.sel) openCard(S.sel, false);
    S.dirty = true;
    app.dir = rtl ? 'rtl' : 'ltr';
  }
  function pinMeta(p) {
    const t = p.mode === 'walk' ? `${svg('walk', 'pm-ic')}${fmtMin(p.walk)}` : `${svg('car', 'pm-ic')}${fmtMin(p.drive)}`;
    return `<span class="pm-d">${distOf(p)}</span><span class="pm-sep"></span><span class="pm-t">${t}</span>`;
  }

  // ---------- chips
  function renderChips() {
    const n = c => POIS.filter(p => c === 'all' || p.cat === c).length;
    $('#panoChips', app).innerHTML = ['all', ...CATS].map(c => `<button type="button" class="pchip${S.filter === c ? ' on' : ''}" data-f="${c}" aria-pressed="${S.filter === c}">${c === 'all' ? '' : svg(c === 'parks' ? 'parks' : c)}<span>${esc(pt(c === 'all' ? 'all' : 'cat.' + c))}</span><em>${n(c)}</em></button>`).join('');
  }
  $('#panoChips', app).addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    S.filter = b.dataset.f;
    if (S.sel && !visibleCat(S.sel)) closeCard();
    renderChips(); applyFilter(); renderList();
    b.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  });
  const visibleCat = p => p.proj || S.filter === 'all' || p.cat === S.filter;
  function applyFilter() {
    for (const { p, el } of pinEls.values()) el.classList.toggle('off', !visibleCat(p));
    radar.querySelectorAll('[data-id]').forEach(g => g.classList.toggle('off', !visibleCat(POIS.find(p => p.id === g.dataset.id))));
    S.dirty = true;
  }

  // ---------- radar (north-up, rings 500 m / 1 / 2 / 5 km, view cone follows the heading)
  // the Uzh (centre line) → bearing/distance from the project → radar polar
  function riverPath() {
    return RIVER_LL.map((ll, i) => {
      const [px, py] = polar(trueBearing(PROJECT_LL, ll), radarR(haversine(PROJECT_LL, ll)));
      return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
    }).join('');
  }
  // ring labels ride the radius that is farthest (in angle) from every place inside the 5 km ring
  const RING_LABEL_B = (() => {
    const bs = POIS.filter(p => !p.onSite && p.dist < 6000).map(p => p.bearing);
    let best = 210, score = -1;
    for (let a = 100; a <= 260; a += 5) { const m = Math.min(...bs.map(b => Math.abs(((a - b + 540) % 360) - 180))); if (m > score) { score = m; best = a; } }
    return best;
  })();
  function renderRadar() {
    const U = CARD[lang] || CARD.en;
    const ringLbl = d => d < 1000 ? `${d} ${U.m}` : `${d / 1000} ${U.km}`;
    let h = `<defs><radialGradient id="prg" r="1"><stop offset="0" stop-color="#1b1712"/><stop offset="1" stop-color="#0b0a08"/></radialGradient>
      <radialGradient id="pcone" cx="0" cy="0" r="97" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e6cc92" stop-opacity=".42"/><stop offset=".7" stop-color="#e6cc92" stop-opacity=".12"/><stop offset="1" stop-color="#e6cc92" stop-opacity="0"/></radialGradient>
      <clipPath id="prc"><circle r="97"/></clipPath></defs>
      <circle r="98" fill="url(#prg)" class="pr-bg"/>
      <path class="pr-river" clip-path="url(#prc)" d="${riverPath()}"/>`;
    for (const d of RINGS) h += `<circle class="pr-ring" r="${radarR(d)}"/>`;
    for (let a = 0; a < 360; a += 30) { const [x1, y1] = polar(a, 91), [x2, y2] = polar(a, a % 90 ? 95 : 98); h += `<line class="pr-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
    for (const d of RINGS) { const [x, y] = polar(RING_LABEL_B, radarR(d)); h += `<text class="pr-rl" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(ringLbl(d))}</text>`; }
    h += `<path class="pr-cone" d=""/>`;
    for (const p of POIS) {
      if (p.onSite) continue;
      const r = radarR(p.dist), [x, y] = polar(p.bearing, r);
      h += `<g class="pr-poi is-${p.mode}${p.dist > 5000 ? ' far' : ''}" data-id="${p.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${esc(nameOf(p))} · ${esc(distOf(p))}</title><circle class="pr-hit" r="7"/><circle class="pr-dot" r="${p.key ? 2.9 : 2.2}"/></g>`;
    }
    h += `<g class="pr-me"><circle r="5.5" class="pr-me-r"/><circle r="2.4" class="pr-me-d"/></g>`;
    h += `<text class="pr-n" x="0" y="-84">${esc(dirName(0, true))}</text>`;
    for (const [b, x, y] of [[90, 86, 0], [180, 0, 85], [270, -86, 0]]) h += `<text class="pr-n pr-n2" x="${x}" y="${y}">${esc(dirName(b, true))}</text>`;
    radar.innerHTML = h;
    applyFilter(); updateRadar();
  }
  let lastCone = '';
  function updateRadar() {
    const cone = radar.querySelector('.pr-cone'); if (!cone || S.map) return;
    const b = heading(), half = hfov() / 2 / RAD;
    const [x1, y1] = polar(b - half, 97), [x2, y2] = polar(b + half, 97);
    const d = `M0 0L${x1.toFixed(1)} ${y1.toFixed(1)}A97 97 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}Z`;
    if (d !== lastCone) { cone.setAttribute('d', d); lastCone = d; }
  }
  radar.addEventListener('click', e => {
    const g = e.target.closest('[data-id]'); if (!g) return;
    select(POIS.find(p => p.id === g.dataset.id), true);
  });

  // ---------- list below the stage
  function renderList() {
    const list = POIS.filter(visibleCat).slice().sort((a, b) => a.dist - b.dist);
    const LIM = 12, show = S.listAll ? list : list.slice(0, LIM);
    $('#panoList', app).innerHTML = show.map(p => `<button type="button" class="pl-row is-${p.mode}${S.sel === p ? ' on' : ''}" data-id="${p.id}">
      <i class="pl-ic">${svg(iconOf(p))}</i><span class="pl-tx"><b dir="auto">${esc(nameOf(p))}</b><small>${kindLine(p)}</small></span>
      <span class="pl-d"><b>${distOf(p)}</b><small>${p.onSite ? '' : p.mode === 'walk' ? svg('walk', 'pm-ic') + fmtMin(p.walk) : svg('car', 'pm-ic') + fmtMin(p.drive)}</small></span></button>`).join('');
    const more = $('#panoMore', app);
    more.hidden = list.length <= LIM;
    more.textContent = S.listAll ? pt('less') : pt('more', { n: list.length });
  }
  $('#panoMore', app).addEventListener('click', () => { S.listAll = !S.listAll; renderList(); });
  $('#panoList', app).addEventListener('click', e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const p = POIS.find(q => q.id === b.dataset.id);
    select(p, true);
    const r = stage.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) (S.map && !card.hidden ? card : stage).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: S.map ? 'nearest' : 'center' });
  });

  // ---------- detail card
  function select(p, fly) {
    if (!p) return;
    S.sel = p; stopAuto();
    openCard(p, true);
    if (fly && !p.onSite && !S.map) flyTo(p);
    for (const v of pinEls.values()) v.el.classList.toggle('sel', v.p === p);
    radar.querySelectorAll('[data-id]').forEach(g => g.classList.toggle('sel', g.dataset.id === p.id));
    $('#panoList', app).querySelectorAll('[data-id]').forEach(b => b.classList.toggle('on', b.dataset.id === p.id));
    S.dirty = true;
  }
  function openCard(p, focus) {
    const walkOK = p.dist <= WALK_ROUTE_MAX && !p.onSite;
    const bNo = p.b ? BUILDINGS[p.b]?.no : null;
    const notes = [p.onSite ? (bNo ? pt('onsiteNote', { n: bNo }) : pt('onsiteNote0')) : '', p.note ? pt(p.note) : '', p.approx ? pt('approx') : ''].filter(Boolean);
    const b = Math.round(p.bearing);
    card.className = `pano-card is-${p.mode}`;
    card.innerHTML = `
      <button type="button" class="pc-x" data-act="close" aria-label="${esc(pt('close'))}">${svg('close')}</button>
      <p class="pc-cat">${svg(iconOf(p))}<span>${esc(pt('cat.' + p.cat))}</span></p>
      <h3 class="pc-title" dir="auto">${esc(nameOf(p))}</h3>
      <p class="pc-kind">${kindLine(p)}</p>
      <dl class="pc-stats">
        <div><dt>${esc(pt('straight'))}</dt><dd>${distOf(p)}</dd></div>
        ${p.onSite ? '' : `<div class="${p.mode === 'walk' ? 'hl' : ''}"><dt>${svg('walk', 'pm-ic')}${esc(pt('walk'))}</dt><dd>≈ ${fmtMin(p.walk)}</dd></div>
        <div class="${p.mode === 'drive' ? 'hl' : ''}"><dt>${svg('car', 'pm-ic')}${esc(pt('drive'))}</dt><dd>≈ ${fmtMin(p.drive)}</dd></div>
        <div><dt>${esc(pt('bearing'))}</dt><dd class="dd-dir">${esc(dirName(b))} · <span dir="ltr">${b}°</span></dd></div>`}
      </dl>
      ${notes.map(n => `<p class="pc-onsite${p.onSite ? '' : ' pc-remark'}">${esc(n)}</p>`).join('')}
      ${p.onSite ? '' : `<div class="pc-acts">
        ${walkOK ? `<a class="btn ${p.mode === 'walk' ? 'primary' : 'gold-outline'} sm" href="${mapsDir(p, 'walk')}" target="_blank" rel="noopener">${svg('walk')}<span>${esc(pt('routeWalk'))}</span></a>` : ''}
        <a class="btn ${p.mode === 'drive' ? 'primary' : 'gold-outline'} sm" href="${mapsDir(p, 'drive')}" target="_blank" rel="noopener">${svg('car')}<span>${esc(pt('routeDrive'))}</span></a>
        <a class="btn link pc-open" href="${mapsOpen(p)}" target="_blank" rel="noopener">${svg('pin')}<span>${esc(pt('open'))}</span></a>
      </div>`}
      <p class="pc-fine">${esc(pt('fine'))}</p>`;
    card.hidden = false;
    stage.classList.add('has-card');
    if (focus && !coarse) requestAnimationFrame(() => card.querySelector('.pc-x')?.focus({ preventScroll: true }));
  }
  function closeCard() {
    card.hidden = true; stage.classList.remove('has-card');
    S.sel = null;
    for (const v of pinEls.values()) v.el.classList.remove('sel');
    radar.querySelectorAll('.sel').forEach(g => g.classList.remove('sel'));
    $('#panoList', app).querySelectorAll('.on').forEach(b => b.classList.remove('on'));
    S.dirty = true;
  }
  card.addEventListener('click', e => { if (e.target.closest('[data-act="close"]')) { closeCard(); stage.focus({ preventScroll: true }); } });
  pinsEl.addEventListener('click', e => {
    const b = e.target.closest('button.pp'); if (!b || S.dragMoved) return;
    select(POIS.find(p => p.id === b.dataset.id), true);
  });

  // ---------- camera state (works with or without WebGL: pins/radar still follow the heading)
  const hfov = () => S.hfov || (W && H && W / H < 1 ? 78 : 96) * RAD;
  function vfov() { const a = W / H || 1.6; return Math.min(100 * RAD, 2 * Math.atan(Math.tan(hfov() / 2) / a)); }
  function heading() { return ((bearingOf(-Math.sin(S.yaw), -Math.cos(S.yaw)) % 360) + 360) % 360; }
  function yawForBearing(b) { const [x, z] = dirOfBearing(b); return Math.atan2(-x, -z); }
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  function flyTo(p) {
    const target = yawForBearing(p.eye.bearing);
    const elev = -Math.atan2(PANO_EYE_H, Math.max(p.eye.dist, 1));
    let pitchT = elev + 0.12;                                 // place slightly below centre → room for its label above
    const sheet = !card.hidden && W <= 760 ? card.offsetHeight : 0;
    if (sheet && H) {                                         // phone: the card is a bottom sheet → aim at ~62 % of the free band
      const yT = (H - sheet) * 0.62, ndc = (H / 2 - yT) / (H / 2);
      pitchT = elev - Math.atan(ndc * Math.tan(vfov() / 2));
    }
    pitchT = clampPitch(Math.max(-1.2, pitchT));
    S.anim = { t0: performance.now(), dur: reduced ? 1 : 950, y0: S.yaw, dy: wrapPi(target - S.yaw), p0: S.pitch, dp: pitchT - S.pitch };
    S.dirty = true; kick();
  }
  function stopAuto() { S.auto = false; S.lastUser = performance.now(); hint.classList.add('gone'); }
  { const b0 = parseFloat(lsGet('vrc.panoBearing', '')); S.yaw = yawForBearing(Number.isFinite(b0) ? b0 : FIRST_BEARING); }   // first look: the city centre

  // ---------- input: drag / swipe, pinch, wheel, keys
  const ptrs = new Map(); let pinch0 = 0, fov0 = 0, drag = null;
  stage.addEventListener('pointerdown', e => {
    if (S.map || e.target.closest('.pano-card, .pano-tools, .pano-radar')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    S.dragMoved = false;
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch, moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); fov0 = hfov(); drag = null; }
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      setFov(fov0 * pinch0 / Math.max(20, d)); S.dragMoved = true; return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    if (drag.moved > 6) {
      if (!S.dragMoved) { S.dragMoved = true; stage.setPointerCapture?.(e.pointerId); stage.classList.add('dragging'); stopAuto(); S.anim = null; }
      const k = hfov() / Math.max(1, W);
      S.yaw = drag.yaw + dx * k;
      S.pitch = clampPitch(drag.pitch + dy * k);
      S.dirty = true; kick();
    }
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = 0;
    if (!ptrs.size) { drag = null; stage.classList.remove('dragging'); setTimeout(() => { S.dragMoved = false; }, 0); lsSet('vrc.panoBearing', Math.round(heading())); }
  };
  stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);
  stage.addEventListener('wheel', e => {
    if (S.map || e.target.closest('.pano-card')) return;
    if (!(S.full || e.ctrlKey || document.activeElement === stage || stage.matches(':hover'))) return;
    e.preventDefault(); stopAuto();
    setFov(hfov() * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)));
  }, { passive: false });
  stage.addEventListener('keydown', e => {
    const k = e.key, step = 6 * RAD;
    if (k === 'Escape') { if (S.sel) closeCard(); else if (S.full) toggleFull(false); return; }
    if (e.target !== stage || S.map) return;
    if (k === 'ArrowLeft') S.yaw += step; else if (k === 'ArrowRight') S.yaw -= step;
    else if (k === 'ArrowUp') S.pitch = clampPitch(S.pitch + step); else if (k === 'ArrowDown') S.pitch = clampPitch(S.pitch - step);
    else if (k === '+' || k === '=') setFov(hfov() / 1.15); else if (k === '-') setFov(hfov() * 1.15);
    else return;
    e.preventDefault(); stopAuto(); S.dirty = true; kick();
  });
  const clampPitch = p => Math.max(-1.45, Math.min(0.55, p));
  function setFov(f) { S.hfov = Math.max(26 * RAD, Math.min(115 * RAD, f)); S.dirty = true; kick(); }

  // ---------- tools
  app.querySelector('.pano-tools').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { setMode(b.dataset.mode); return; }
    const a = b.dataset.act;
    if (a === 'zin') setFov(hfov() / 1.25);
    else if (a === 'zout') setFov(hfov() * 1.25);
    else if (a === 'full') toggleFull(!S.full);
    else if (a === 'gyro') toggleGyro();
    stopAuto();
  });
  function markMode() { app.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode))); }
  function setMode(m) {
    if (m === S.mode || !MODES.includes(m)) return;
    const prev = S.mode; S.mode = m; markMode();
    if (!gl) { lsSet('vrc.panoMode', m); return; }
    // the other light may not have been captured: then stay on the one that is showing
    loadFaces(m).then(() => lsSet('vrc.panoMode', m), () => { if (S.mode === m) { S.mode = prev; markMode(); stage.classList.remove('loading'); } });
  }
  markMode();

  // fullscreen: real Fullscreen API where it exists (not on iPhone Safari) → otherwise a fixed overlay
  function toggleFull(on) {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (on) {
      const req = app.requestFullscreen || app.webkitRequestFullscreen;
      if (req && !coarse) { try { const r = req.call(app); if (r?.catch) r.catch(() => pseudoFull(true)); } catch (err) { pseudoFull(true); } }
      else pseudoFull(true);
    } else {
      if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      pseudoFull(false);
    }
  }
  function pseudoFull(on) {
    app.classList.toggle('is-full', on); document.documentElement.classList.toggle('pano-open', on);
    setFull(on);
  }
  function setFull(on) {
    S.full = on; fullBtn.innerHTML = svg(on ? 'unfull' : 'full'); fullBtn.setAttribute('aria-label', pt(on ? 'exitFull' : 'full'));
    requestAnimationFrame(resize);
  }
  const onFs = () => { const on = (document.fullscreenElement || document.webkitFullscreenElement) === app; if (!on) app.classList.remove('is-full'); setFull(on || app.classList.contains('is-full')); };
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);

  // gyroscope: only after an explicit tap (iOS asks for DeviceOrientation permission inside that gesture)
  if (coarse && typeof window.DeviceOrientationEvent !== 'undefined') gyroBtn.hidden = false;
  let gyroH = null;
  async function toggleGyro() {
    if (S.gyro) { removeEventListener('deviceorientation', gyroH); S.gyro = null; gyroBtn.classList.remove('on'); gyroBtn.setAttribute('aria-label', pt('gyro')); return; }
    try {
      const DOE = window.DeviceOrientationEvent;
      if (typeof DOE.requestPermission === 'function') { const r = await DOE.requestPermission(); if (r !== 'granted') throw new Error('denied'); }
    } catch (err) { flash(pt('gyroDenied')); return; }
    S.gyro = { off: null };
    gyroH = ev => {
      if (ev.alpha == null) return;
      const { yaw, pitch } = orient(ev);
      if (S.gyro.off == null) S.gyro.off = S.yaw - yaw;
      S.yaw = yaw + S.gyro.off; S.pitch = clampPitch(pitch); S.anim = null; S.dirty = true; kick();
    };
    addEventListener('deviceorientation', gyroH);
    gyroBtn.classList.add('on'); gyroBtn.setAttribute('aria-label', pt('gyroOff'));
    setTimeout(() => { if (S.gyro && S.gyro.off == null) flash(pt('gyroNone')); }, 1500);
  }
  // DeviceOrientation (alpha, beta, gamma, screen angle) → camera yaw/pitch (same maths as three's old DeviceOrientationControls)
  function orient(ev) {
    const a = ev.alpha * RAD, b = ev.beta * RAD, g = ev.gamma * RAD;
    const o = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * RAD;
    // quaternion from Euler YXZ (b, a, -g), then -90° about X, then -o about Z
    const e = eulerToQuat(b, a, -g), qx = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], qz = [0, 0, Math.sin(-o / 2), Math.cos(-o / 2)];
    const q = qmul(qmul(e, qx), qz);
    const [x, y, z, w] = q;                          // forward = q · (0,0,-1)
    const fx = -(2 * (x * z + w * y)), fy = -(2 * (y * z - w * x)), fz = -(1 - 2 * (x * x + y * y));
    return { yaw: Math.atan2(-fx, -fz), pitch: Math.asin(Math.max(-1, Math.min(1, fy))) };
  }
  function eulerToQuat(x, y, z) { // order YXZ
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  }
  function qmul([ax, ay, az, aw], [bx, by, bz, bw]) {
    return [ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz];
  }
  let flashT = 0;
  function flash(msg) {
    hint.classList.remove('gone'); hint.querySelector('span').textContent = msg; hint.classList.add('msg');
    clearTimeout(flashT); flashT = setTimeout(() => { hint.classList.add('gone'); hint.classList.remove('msg'); }, 2600);
  }

  // ---------- pin projection + label layout (screen-space greedy, no overlaps)
  function dirFor(p) {
    if (p.proj) { const [x, y, z] = p.world; return norm([x - PANO_EYE[0], y - PANO_EYE[1], z - PANO_EYE[2]]); }
    return norm([p.eye.dx, -PANO_EYE_H, p.eye.dz]);
  }
  function dirAt(b, d) { const [dx, dz] = dirOfBearing(b); return norm([dx * d, -PANO_EYE_H, dz * d]); }
  const norm = ([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const STEM0 = 20;
  function project(d) {
    // camera basis from yaw/pitch (Euler YXZ): forward f, right r, up u
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy], u = [sy * sp, cp, cy * sp];
    const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (z <= 0.05) return null;
    const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / z, y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / z;
    const tx = Math.tan(hfov() / 2), ty = Math.tan(vfov() / 2);
    return [W / 2 + x / tx * W / 2, H / 2 - y / ty * H / 2];
  }
  function layout() {
    if (S.map) return;
    const placed = [];
    const top = 52, bottom = H - 8;
    // keep clear of overlays: tools (inline-end top), radar (bottom corner), open card
    const blocks = [];
    const sr = stage.getBoundingClientRect();
    for (const sel of ['.pano-tools', '.pano-radar', '.pano-card:not([hidden])']) {
      const el = stage.querySelector(sel); if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect(); blocks.push({ x: r.left - sr.left - 4, y: r.top - sr.top - 4, w: r.width + 8, h: r.height + 8 });
    }
    const hit = (a) => blocks.some(b => ov(a, b)) || placed.some(b => ov(a, b));
    const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const vis = [];
    for (const v of pinEls.values()) {
      if (!visibleCat(v.p)) { v.el.style.visibility = 'hidden'; continue; }
      v.dir = v.dir || dirFor(v.p);
      const s = project(v.dir);
      if (!s || s[0] < -30 || s[0] > W + 30 || s[1] < top - 10 || s[1] > bottom + 30) { v.el.style.visibility = 'hidden'; continue; }
      if (!v.w) { v.w = v.cardEl.offsetWidth || 150; v.h = v.cardEl.offsetHeight || 44; }
      vis.push([v, s]);
    }
    // every visible anchor dot is an obstacle, so no label ever covers another place's dot
    for (const [, [x, y]] of vis) placed.push({ x: x - 9, y: y - 9, w: 18, h: 18 });
    // ring tags: prefer the inline-start side of the view (the radar owns the inline-end corner), else the other side,
    // else the centre; never under an overlay, a label or a place's dot
    const side = (app.dir === 'rtl' ? 1 : -1) * hfov() / RAD * 0.3;
    for (const g of ringTags) {
      let done = false;
      for (const off of gl ? [side, -side, side * 0.5, -side * 0.5, 0] : []) {
        const s = project(dirAt(heading() + off, g.r));
        if (!s || s[1] < top + 20 || s[1] > bottom - 16 || s[0] < 40 || s[0] > W - 40) continue;
        const r = { x: s[0] - 32, y: s[1] - 12, w: 64, h: 24 };
        if (hit(r)) continue;
        placed.push(r); g.el.style.visibility = 'visible'; done = true;
        g.el.style.transform = `translate3d(${s[0].toFixed(1)}px,${s[1].toFixed(1)}px,0) translate(-50%,-50%)`;
        break;
      }
      if (!done) g.el.style.visibility = 'hidden';
    }
    const rank = v => (v.p === S.sel ? -1e9 : 0) + (v.p.proj ? -1e8 : 0) + (v.p.key ? -1e6 : 0) + (v.p.dist || 0);
    vis.sort((a, b) => rank(a[0]) - rank(b[0]));
    for (const [v, [x, y]] of vis) {
      // candidate slots: stems growing by one label height, and at each height the card centred or slid sideways
      // (it always keeps the stem under its own width) — dense, overlap-free stacking above the horizon
      let ok = null;
      const shift = Math.max(0, v.w / 2 - 16), xs = [0, -shift, shift];
      for (let st = STEM0; !ok && y - st - v.h >= top; st += v.h + 7) {
        for (const off of xs) {
          let cx = x - v.w / 2 + off; cx = Math.max(6, Math.min(W - 6 - v.w, cx));
          const r = { x: cx - 3, y: y - st - v.h - 3, w: v.w + 6, h: v.h + 6 };
          if (!hit(r)) { ok = { st, dx: cx - (x - v.w / 2) }; placed.push(r); break; }
        }
      }
      const el = v.el;
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      if (ok) { el.classList.remove('mini'); el.style.setProperty('--stem', ok.st + 'px'); el.style.setProperty('--dx', ok.dx.toFixed(1) + 'px'); }
      else el.classList.add('mini');
    }
  }
  function updateCompass() {
    const b = heading();
    strip.style.transform = `translate3d(${(-(b + 180) * PXD).toFixed(1)}px,0,0)`;
    degEl.textContent = `${Math.round(b) % 360}° ${dirName(b, true)}`;
  }

  // ---------- frame loop (renders only when something changed; sleeps off-screen)
  let raf = 0, lastT = 0, onScreen = false;
  function kick() { if (!raf && onScreen && !document.hidden) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    let moving = false;
    if (S.anim) {
      const a = S.anim, k = Math.min(1, (now - a.t0) / a.dur), e = k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      S.yaw = a.y0 + a.dy * e; S.pitch = a.p0 + a.dp * e; S.dirty = true; moving = true;
      if (k >= 1) S.anim = null;
    } else if (S.auto && gl && !S.gyro) {
      S.yaw -= dt * 0.045; S.dirty = true; moving = true;
    } else if (!S.auto && !reduced && !S.sel && !S.gyro && !S.full && gl && now - S.lastUser > 30000 && !ptrs.size) S.auto = true;
    if (S.dirty) {
      S.dirty = false;
      if (gl) renderGL();
      layout(); updateCompass(); updateRadar();
    }
    if (moving || S.gyro || S.dirty) kick();
  }
  function renderGL() {
    const { camera, renderer, scene } = gl;
    const vf = vfov() / RAD;
    if (Math.abs(camera.fov - vf) > 1e-4 || camera.aspect !== W / H) { camera.fov = vf; camera.aspect = W / H; camera.updateProjectionMatrix(); }
    camera.rotation.set(S.pitch, S.yaw, 0, 'YXZ');
    renderer.render(scene, camera);
  }
  function resize() {
    const r = stage.getBoundingClientRect(); W = Math.round(r.width); H = Math.round(r.height);
    if (gl) gl.renderer.setSize(W, H, false);
    S.dirty = true; kick();
  }
  new ResizeObserver(resize).observe(stage);
  document.addEventListener('visibilitychange', kick);

  // ---------- WebGL (lazy)
  let started = false;
  const io = new IntersectionObserver(es => {
    for (const e of es) {
      if (e.target === stage) { onScreen = e.isIntersecting; if (onScreen) { resize(); kick(); } }
    }
    if (!started && !S.map && es.some(e => e.isIntersecting)) { started = true; initGL(); }
  }, { rootMargin: '500px 0px' });
  io.observe(stage);

  async function initGL() {
    try {
      if (!(() => { try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch (e) { return false; } })()) throw new Error('no webgl');   // T32: probe first — three.js logs console.error when it cannot create a context
      const THREE = await import('three');
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!renderer.getContext()) throw new Error('no webgl');
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.className = 'pano-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      $('.pano-gl', app).appendChild(renderer.domElement);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0a08);
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      const faces = {};
      const cap = new THREE.PerspectiveCamera(90, 1, 0.1, 10);
      for (const f of PANO_FACES) {
        const m = new THREE.MeshBasicMaterial({ color: 0x111111, depthWrite: false, depthTest: false });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.004, 2.004), m);
        cap.up.set(...f.up); cap.position.set(0, 0, 0); cap.lookAt(...f.dir);
        mesh.quaternion.copy(cap.quaternion);
        mesh.position.set(f.dir[0], f.dir[1], f.dir[2]);
        scene.add(mesh); faces[f.id] = mesh;
      }
      buildGroundRings(THREE, scene);
      gl = { THREE, renderer, scene, camera, faces, loadSeq: 0, maxAniso: renderer.capabilities.getMaxAnisotropy() };
      resize();
      try { await loadFaces(S.mode); } catch (err) {
        // faces vanished after the probe (or only the other light exists) → the other light, else the flat map
        const other = MODES.find(m => m !== S.mode);
        try { if (!other) throw err; await loadFaces(other); S.mode = other; markMode(); } catch (e2) {
          renderer.dispose(); renderer.domElement.remove(); gl = null;
          setMapMode(); renderText(); return;
        }
      }
      veil.classList.add('gone');
      setTimeout(() => { if (!hint.classList.contains('msg')) hint.classList.add('gone'); }, 7000);
      S.dirty = true; kick();
    } catch (err) {
      console.warn('[panorama] WebGL view unavailable:', err?.message || err);
      stage.classList.add('no-gl');
      veil.querySelector('.pv-t').textContent = pt('fail');
      veil.classList.add('fail');
      S.dirty = true; kick();
    }
  }
  // Distance rings painted on the (flat) ground around the eye: a ground-plane band of world width ∝ radius, every vertex
  // pushed onto a sphere inside the cube (r = 0.9) so it overlays the panorama at exactly the right place; dashed + glow.
  function buildGroundRings(THREE, scene) {
    const SEG = 240;
    for (const g of GROUND_RINGS) {
      const col = new THREE.Color(g.c === 'walk' ? 0x6fd8cf : 0xe6cc92);
      for (const [wk, op, dash] of [[0.045, 0.10, false], [0.011, g.c === 'walk' ? 0.85 : 0.6, true]]) {
        const pos = [], idx = []; const w = g.r * wk;
        for (let i = 0; i < SEG; i++) {
          if (dash && i % 3 === 2) continue;                    // 2 on, 1 off
          const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2, base = pos.length / 3;
          for (const [a, rr] of [[a0, g.r - w / 2], [a0, g.r + w / 2], [a1, g.r - w / 2], [a1, g.r + w / 2]]) {
            const [x, y, z] = norm([Math.sin(a) * rr, -PANO_EYE_H, -Math.cos(a) * rr]);
            pos.push(x * 0.9, y * 0.9, z * 0.9);
          }
          idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
        const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = 2; mesh.frustumCulled = false; scene.add(mesh);
      }
    }
  }
  function faceSize() {
    const px = Math.max(W, H) * Math.min(devicePixelRatio || 1, 2);
    return px > 1100 && !coarse ? PANO_SIZES[0] : SMALL;
  }
  const SMALL = PANO_SIZES[PANO_SIZES.length - 1];
  function loadFaces(mode) {
    return loadFacesAt(mode, faceSize()).catch(err => { if (faceSize() === SMALL) throw err; return loadFacesAt(mode, SMALL); });
  }
  function loadFacesAt(mode, size) {
    const { THREE, faces } = gl, seq = ++gl.loadSeq;
    const loader = new THREE.TextureLoader();
    const bar = veil.querySelector('.pv-bar i');
    let n = 0;
    stage.classList.add('loading');
    return Promise.all(PANO_FACES.map(f => new Promise((res, rej) => {
      loader.load(faceUrl(mode, size, f.id), tex => {
        n++; bar.style.transform = `scaleX(${n / 6})`;
        if (seq !== gl.loadSeq) { tex.dispose(); return res(); }
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, gl.maxAniso);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        f._tex = tex; res();
      }, undefined, () => rej(new Error('face ' + f.id)));
    }))).then(() => {
      if (seq !== gl.loadSeq) return;
      for (const f of PANO_FACES) {
        const m = faces[f.id].material; const old = m.map;
        m.map = f._tex; m.color.set(0xffffff); m.needsUpdate = true; if (old) old.dispose(); f._tex = null;
      }
      stage.classList.remove('loading');
      S.dirty = true; kick();
    });
  }

  // ---------- go
  renderText();
  onLangChange(() => renderText());
  requestAnimationFrame(() => { resize(); });
}
