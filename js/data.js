// ЖК VILNYI (Ужгород) — single source of truth: project facts, levels, buildings, floor plates, apartment types, units, site, prices.
// Hand-written API (CONTRACT §1.5–§1.13, §2) over three generated modules — geometry and counts come ONLY from them:
//   data-plates.js   SITE, PLATES, GENERATED   (tools/build-data.mjs ← data/plates-B1..B4.json, site.json, surroundings.json)
//   data-progress.js PROGRESS                  (← data/progress.json)
//   data-sales.js    SALES                     (← data/sales.json; real price / status table, empty until the owner supplies it)
// Units: metres, Y up. Importable in Node (no DOM access).
//
// Frames (see the header of data-plates.js):
//   building-local: x right on the plan sheet, z DOWN the sheet; origin = SW corner (min x, max z) of the typical plate's bounding
//                   box → inside the typical plate x ∈ [0, W], z ∈ [−D, 0].
//   world:          same axes on the complex plan, origin = centre of the courtyard ring. world = origin + R(rotY)·local.
//   unit-local:     u along the entrance wall (0 … width), v from the entrance wall (0) into the flat (… depth); (U, Y, V) right-handed.
//   compass:        COMPASS.negZ = true bearing of world −z (339.1°). Directions are vectors; letters only through bearingOf().
import { SITE, PLATES, GENERATED } from './data-plates.js';
import { PROGRESS } from './data-progress.js';
import { SALES } from './data-sales.js';

export { SITE, PLATES, GENERATED, PROGRESS, SALES };

// ---------- Project ----------
// Facts: plans.pdf (counts, geometry), lun.ua listing of 28.09.2026 (prices, terms, documents — "per the public listing"),
// vilnyi.group (contacts, office hours, developer). Nothing here is invented; unknown values stay empty.
export const PROJECT = {
  name: 'ЖК VILNYI', nameLatin: 'VILNYI', brand: ['VILNYI', 'УЖГОРОД'],
  developer: 'VILNYI Group', class: 'business',
  tagline: { uk: 'Житловий комплекс бізнес-класу в Ужгороді', en: 'Business-class residential complex in Uzhhorod' },   // real copy: i18n 'terms.tagline'
  address: { uk: 'вул. Михайла Грушевського, 4А, Ужгород', en: '4A Mykhaila Hrushevskoho St, Uzhhorod, Ukraine' },
  district: { uk: 'район «Новий»', en: 'Novyi district' },
  geo: { lat: 48.61133, lon: 22.27685, est: false },                    // plot centre (OpenStreetMap)
  totals: { buildings: 4, apartments: 462, byRooms: { 1: 310, 2: 130, 3: 22 }, parking: 155, plotHa: 0.896 },
  currency: 'UAH',
  numbering: 'provisional',                                             // no apartment numbers on the plans: apNo is sequential
  facts: {
    tech: 'monolith-frame', walls: 'ceramic-block', insulation: 'mineral-wool', heating: 'autonomous-roof-boiler',
    ceiling: 2.8, generator: true, shelter: 'underground-parking', finishing: 'none',
    permit: { number: 'ІУ013240916905', date: '2024-09-18', source: 'lun.ua', confirm: true },
    contractor: { name: 'ТОВ «ВІНЕРБУД»', source: 'lun.ua', confirm: true },
    customer: { name: 'ОК «ЖБК «ВІЛЬНИЙ»', source: 'lun.ua', confirm: true },
    cadastral: { number: '2110100000:21:001:0432', source: 'lun.ua', confirm: true },
  },
  developerInfo: { name: 'VILNYI Group', years: 15, site: 'https://vilnyi.group', otherProjects: [{ city: 'Larnaca', names: ['QCC2', 'Q CITIUM', 'Habitat'] }] },
  terms: {
    instalment: { months: 17, firstPayment: [30, 50] },                // lun: "На 1 рік та 5 місяців · 1-й внесок від 30% – 50%"
    plans: [
      { id: 'full', split: [100, 0], months: 0, label: { uk: '100% оплата', en: 'Full payment' },
        desc: { uk: 'Повна оплата вартості квартири при укладанні договору.', en: 'The full price is paid when the contract is signed.' } },
      { id: 'inst50', split: [50, 50], months: 17, label: { uk: 'Розтермінування · 50%', en: 'Instalments · 50% down' },
        desc: { uk: 'Перший внесок 50%, решта — розтермінування від забудовника до 1 року 5 місяців.', en: '50% first payment, the rest in developer instalments over up to 1 year 5 months.' } },
      { id: 'inst30', split: [30, 70], months: 17, label: { uk: 'Розтермінування · 30%', en: 'Instalments · 30% down' },
        desc: { uk: 'Перший внесок 30%, решта — розтермінування від забудовника до 1 року 5 місяців.', en: '30% first payment, the rest in developer instalments over up to 1 year 5 months.' } },
    ],
    discounts: [
      { id: 'military', percent: 5, label: { uk: 'Військовим', en: 'Military personnel' } },
      { id: 'medical', percent: 5, label: { uk: 'Медичним працівникам', en: 'Medical workers' } },
    ],                                                                   // discounts do not stack
    statePrograms: { eOselya: false, eVidnovlennia: false, credit: false },
    parking: { area: [15, 24], ppm: [28250, 45200], source: 'lun.ua' },  // parking places, m² and UAH per m² (listing)
    reservationDeposit: null, rentGuarantee: null, marketRent2c: null,   // legacy keys, null = feature absent
    contract: { uk: '', en: '' },
  },
  bank: { beneficiary: '', iban: '', bic: '', bank: '', address: '' },   // stay empty
  payments: { stripePaymentLink: '' },
  leadsEndpoint: '', leadsKey: '',                                       // EMPTY until the owner issues a key for this project
  contact: {
    phone: '+380500100723', viber: '+380675279818', whatsapp: '', email: 'gvilnyi@gmail.com', site: 'https://vilnyi.group',
    instagram: 'https://www.instagram.com/vilnyi.uzhhorod/', facebook: 'https://www.facebook.com/profile.php?id=61552331798401',
    office: { uk: 'вул. Грушевського, 23, Ужгород', en: '23 Hrushevskoho St, Uzhhorod' },
    hours: { 'mon-fri': '10:00–18:00', sat: '11:00–15:00', sun: null },  // vilnyi.group
  },
  features: { hero3d: true, walk: true, pano360: 'auto', photoTour: false, progress: true, drive: true, booking: 'lead' },
  // legacy aliases so untouched code does not crash:
  permit: { number: '', date: '', issuer: '', applicant: '', designer: '', cadastral: '', totalApartments: 462, parkingPlaces: 155, regime: '', pot: '', cut: '' },
  phase: '', deliveryMonths: null, partner: { name: 'VILNYI Group', role: {} },
};

// ---------- Buildings ----------
export const B_IDS = Object.keys(SITE.buildings).sort();
const DELIVERY_FALLBACK = { B1: { q: 3, year: 2027 }, B2: { q: 4, year: 2026 }, B3: { q: 3, year: 2027 }, B4: { q: 4, year: 2027 } };   // lun.ua, 15.09.2026
const STATUS_FALLBACK = { B1: 'building', B2: 'building', B3: 'building', B4: 'prep' };
export const BUILDINGS = {};
for (const id of B_IDS) {
  const s = SITE.buildings[id], p = PROGRESS.buildings?.[id] || {};
  const d = p.delivery || DELIVERY_FALLBACK[id] || null;
  BUILDINGS[id] = { id, no: s.no, label: 'Будинок №' + s.no, origin: s.origin, rotY: s.rotY || 0, mirror: false, floors: s.floors, apartments: s.apartments,
    delivery: d ? { q: d.q, year: d.year, confirmed: false } : null, status: p.status || STATUS_FALLBACK[id] || 'building', statusDate: p.statusDate || null,
    typical: s.typical, phase: s.phase ?? null, parapetY: s.parapet ?? null, topY: s.top ?? null };
}
export function localToWorld(bId, x, z) {
  const b = BUILDINGS[bId]; const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
  return [b.origin[0] + x * c + z * s, b.origin[1] - x * s + z * c];
}
export function worldToLocal(bId, x, z) {
  const b = BUILDINGS[bId]; const c = Math.cos(b.rotY), s = Math.sin(b.rotY); const dx = x - b.origin[0], dz = z - b.origin[1];
  return [dx * c - dz * s, dx * s + dz * c];
}

// ---------- Levels and floors ----------
// Floor 1 IS the ground floor (Ukrainian convention); there is NO floor 0. Parking is −1. Levels are the real marks of the
// sections: 0.000, +3.600, +6.750, then +3.150 per floor; floor 12 is 3.30 m high where it exists.
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const _lv = id => SITE.buildings[id].levels;
const _heights = B_IDS.flatMap(id => _lv(id).slice(1).map((y, i) => +(y - _lv(id)[i]).toFixed(3)));
export const LEVELS = {
  parkingY: SITE.parking?.y ?? -4.2, groundY: 0,
  groundH: +median(B_IDS.map(id => _lv(id)[1] - _lv(id)[0])).toFixed(2) || 3.6,      // 3.60
  typicalH: +median(_heights.filter((h, i) => h < 3.5)).toFixed(2) || 3.15,           // 3.15
  ceiling: 2.8, slab: 0.35,
};
export const GROUND_FLOOR = 1;
export const PARKING_FLOOR = -1;
const _B = bId => SITE.buildings[bId];
let _warnedFloorY = false;
const _poly1 = (bId, floor) => { if (typeof bId === 'number' || bId == null) { if (!_warnedFloorY) { _warnedFloorY = true; console.warn('floorY without building'); } return [B_IDS[0], bId]; } return [bId, floor]; };
export function floorsOf(bId) { const b = _B(bId); return b ? Array.from({ length: b.floors }, (_, i) => i + 1) : []; }
export function topFloor(bId) { return _B(bId)?.floors ?? 0; }
export function liftFloors(bId) { return [PARKING_FLOOR, ...floorsOf(bId)]; }
export function roofY(bId) { return _B(bId).roof; }
export function floorY(bId, floor) {                                     // y of the finished floor
  [bId, floor] = _poly1(bId, floor);
  const b = _B(bId); if (floor <= PARKING_FLOOR) return LEVELS.parkingY; if (floor < 1) return 0;
  return floor > b.floors ? b.roof : b.levels[floor - 1];
}
export function floorH(bId, floor) {                                     // storey height: next level (or roof) minus this level
  const b = _B(bId); if (floor <= PARKING_FLOOR) return LEVELS.groundY - LEVELS.parkingY;
  const f = Math.max(1, Math.min(b.floors, floor)); return +((f < b.floors ? b.levels[f] : b.roof) - b.levels[f - 1]).toFixed(3);
}
export function floorFromY(bId, y) {                                     // floor whose band [level, next level) contains y
  const b = _B(bId); if (y < b.levels[0] - 1e-6) return PARKING_FLOOR;
  let f = 1; for (let i = 0; i < b.floors; i++) if (y >= b.levels[i] - 1e-6) f = i + 1; return f;
}
export function floorLabel(floor) { return floor === PARKING_FLOOR ? '−1' : String(floor); }
export function isGround(floor) { return floor === GROUND_FLOOR; }
export const TOP_FLOOR = Math.max(...B_IDS.map(topFloor));               // LEGACY = max over buildings (17). Global ranges only.
export const ROOF_Y = Math.max(...B_IDS.map(roofY));                     // LEGACY = max roof over buildings.

// ---------- Compass & geography ----------
export const COMPASS = { negZ: SITE.north };
export function bearingOf(dx, dz) { const b = Math.atan2(dx, -dz) * 180 / Math.PI + COMPASS.negZ; return ((b % 360) + 360) % 360; }
export function dirOfBearing(deg) { const a = (deg - COMPASS.negZ) * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; }
// Geographic frame: gx = metres east, gz = metres south of the anchor (PROJECT.geo lat/lon); the anchor sits at world SITE.geo.world.
const GEO = { anchorGeo: [0, 0], anchorWorld: SITE.geo.world };
const GEO_A = (COMPASS.negZ - 360) * Math.PI / 180, GEO_C = Math.cos(GEO_A), GEO_S = Math.sin(GEO_A);
export function geoToWorld(gx, gz) {
  const dx = gx - GEO.anchorGeo[0], dz = gz - GEO.anchorGeo[1];
  return [GEO.anchorWorld[0] + dx * GEO_C + dz * GEO_S, GEO.anchorWorld[1] - dx * GEO_S + dz * GEO_C];
}
export function worldToGeo(x, z) {
  const dx = x - GEO.anchorWorld[0], dz = z - GEO.anchorWorld[1];
  return [GEO.anchorGeo[0] + dx * GEO_C - dz * GEO_S, GEO.anchorGeo[1] + dx * GEO_S + dz * GEO_C];
}
const M_LAT = 111320, M_LON = 111320 * Math.cos(SITE.geo.lat * Math.PI / 180);
export function llToWorld(lat, lon) { return geoToWorld((lon - SITE.geo.lon) * M_LON, -(lat - SITE.geo.lat) * M_LAT); }
export function worldToLL(x, z) { const [gx, gz] = worldToGeo(x, z); return [SITE.geo.lat - gz / M_LAT, SITE.geo.lon + gx / M_LON]; }

// ---------- Plates, cores, hall ----------
const _plateByFloor = {};
for (const id of B_IDS) { _plateByFloor[id] = {}; for (const p of PLATES[id] || []) for (const f of p.floors) _plateByFloor[id][f] = p; }
export function platesOf(bId) { return PLATES[bId] || []; }
export function plateOf(bId, floor) { return _plateByFloor[bId]?.[floor] ?? null; }
export function typicalPlate(bId) { const ps = platesOf(bId); return ps.find(p => p.id === SITE.buildings[bId]?.typical) || ps.reduce((m, p) => (!m || p.floors.length > m.floors.length ? p : m), null); }
const _plate = (bId, floor) => (floor == null ? typicalPlate(bId) : plateOf(bId, floor) || typicalPlate(bId));
export function footprintOf(bId, floor) { return _plate(bId, floor)?.outline ?? []; }
export function corridorsOf(bId, floor) { return _plate(bId, floor)?.hall ?? []; }
// boundary of the union of rects: [{ axis:'x'|'z', c, a0, a1, side }] — axis 'x' = wall along x at z = c; side points INTO the hall
function edgesOfRects(rects) {
  if (!rects.length) return [];
  const uniq = a => [...new Set(a)].sort((p, q) => p - q);
  const xs = uniq(rects.flatMap(r => [r.x0, r.x1])), zs = uniq(rects.flatMap(r => [r.z0, r.z1])), nx = xs.length - 1, nz = zs.length - 1;
  const at = (i, j) => { if (i < 0 || j < 0 || i >= nx || j >= nz) return false; const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2; return rects.some(r => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1); };
  const raw = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) { const up = at(i, j - 1), dn = at(i, j); if (up !== dn) raw.push({ axis: 'x', c: zs[j], a0: xs[i], a1: xs[i + 1], side: dn ? 1 : -1 }); }
  for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) { const lf = at(i - 1, j), rt = at(i, j); if (lf !== rt) raw.push({ axis: 'z', c: xs[i], a0: zs[j], a1: zs[j + 1], side: rt ? 1 : -1 }); }
  raw.sort((p, q) => p.axis.localeCompare(q.axis) || p.c - q.c || p.side - q.side || p.a0 - q.a0);
  const out = [];
  for (const e of raw) { const l = out[out.length - 1]; if (l && l.axis === e.axis && l.c === e.c && l.side === e.side && Math.abs(l.a1 - e.a0) < 1e-9) l.a1 = e.a1; else out.push({ ...e }); }
  return out;
}
const _edgeCache = new Map();
export function hallEdgesOf(bId, floor) {
  const p = _plate(bId, floor); if (!p) return [];
  if (p.hallEdges) return p.hallEdges;                                   // precomputed by build-data.mjs with the same algorithm
  if (!_edgeCache.has(p)) _edgeCache.set(p, edgesOfRects(p.hall));
  return _edgeCache.get(p);
}
const _coreCache = new Map();
// ALWAYS a one-element array (one stair/lift core per tower), legacy fields + new ones
export function coresOf(bId, floor) {
  const p = _plate(bId, floor); if (!p) return [];
  if (!_coreCache.has(p)) {
    const c = p.core, g = plateOf(bId, GROUND_FLOOR), lifts = c.lifts.filter(l => l.door);
    _coreCache.set(p, [{ stair: 1, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, lifts: c.lifts, stairs: c.stairs, balcony: c.balcony ?? null,
      liftDoors: lifts.map(l => l.door), liftNormals: lifts.map(l => l.n), liftNormal: lifts[0]?.n ?? [0, 1],
      entrance: g?.entrance?.p ?? null, entranceNormal: g?.entrance?.n ?? null, zOut: null }]);
  }
  return _coreCache.get(p);
}
function pointInPoly(p, x, z) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }

// ---------- Money, prices, status ----------
// UAH per m² of the printed total area, lun.ua listing of 28.09.2026. The listing gives prices per building and room count for
// buildings 1, 3 and 4 (PRICE_TABLE); building 2 and the 2-room flats of building 4 are not on it → PRICE_BY_ROOMS, priceSource 'rooms'
// (shown as an estimate). 1-room: the listing range is 47 450 – 52 000: 47 450 applies to building 4, 52 000 to the others.
// data/sales.json → SALES overrides price / ppm / status per unit id.
export const PRICE_BY_ROOMS = { 1: 52000, 2: 56500, 3: 52000 };
export const PRICE_TABLE = { B1: { 1: 52000, 2: 56500, 3: 52000 }, B3: { 1: 52000, 2: 56500 }, B4: { 1: 47450 } };
export const PRICE_RANGE = { min: 47450, max: 56500 };
export const PRICE_PER_M2 = PRICE_RANGE.min;                             // LEGACY name = "from" price. Never show it as "the" price.
export const STATUSES = ['available', 'reserved', 'sold', 'blocked'];
export function pricePerM2(u) { return SALES.units[u.id]?.ppm ?? PRICE_TABLE[u.building]?.[u.rooms] ?? PRICE_BY_ROOMS[Math.min(u.rooms, 3)]; }
export function priceOf(u) { return SALES.units[u.id]?.price ?? Math.round(TYPES[u.type].total * pricePerM2(u)); }
export function priceSourceOf(u) { const s = SALES.units[u.id]; return s && (s.price != null || s.ppm != null) ? 'list' : PRICE_TABLE[u.building]?.[u.rooms] != null ? 'table' : 'rooms'; }
export function money(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₴'; }   // '1 794 000 ₴'

// ---------- Apartment types: one per distinct plate slot ----------
// kind: living | kitchen | hall | bedroom | bath | storage | dressing | balcony | loggia | terrace     level: always 0 (no duplexes)
const OUTDOOR = new Set(['loggia', 'balcony', 'terrace']);
const pad2 = n => String(n).padStart(2, '0');
const fmtUk = n => n.toFixed(2).replace('.', ',');
const sum = a => +a.reduce((m, v) => m + (v || 0), 0).toFixed(2);
function planOf(list) {                                                  // normalised room list for the 3D planner (apartment.js)
  const rooms = list.map(r => ({ ...r })), indoor = rooms.filter(r => !OUTDOOR.has(r.kind));
  let living = indoor.filter(r => r.kind === 'living').sort((a, b) => b.area - a.area)[0];
  if (!living) { living = indoor.filter(r => r.kind === 'bedroom').sort((a, b) => b.area - a.area)[0]; if (living) living.kind = 'living'; }
  indoor.forEach(r => { if (r.kind === 'living' && r !== living) r.kind = 'bedroom'; });
  const out = []; const R = (kind, name, area) => ({ kind, name, area: +area.toFixed(2), level: 0 });
  let kitchens = indoor.filter(r => r.kind === 'kitchen');
  if (living) {
    let la = living.area;
    if (!kitchens.length && living.kitchen) { const ka = Math.max(4, Math.min(9, 0.3 * la)); la -= ka; kitchens = [{ kind: 'kitchen', name: 'Кухня', area: ka }]; }
    out.push(R('living', living.name, la));
  }
  kitchens.forEach(k => out.push(R('kitchen', k.name, k.area)));
  const halls = indoor.filter(r => r.kind === 'hall'); if (halls.length) out.push(R('hall', halls[0].name, sum(halls.map(h => h.area))));
  for (const kind of ['bedroom', 'bath', 'dressing', 'storage']) indoor.filter(r => r.kind === kind).forEach(r => out.push(R(kind, r.name, r.area)));
  const od = rooms.find(r => OUTDOOR.has(r.kind)); if (od) out.push(R(od.kind, od.name, od.area));
  return out;
}
export const TYPES = {};
export const TWO_ROOM_VARIANTS = [];                                     // legacy, empty
const typeKey = (bId, plateId, slot) => `${BUILDINGS[bId].no}${plateId}${pad2(slot)}`;
for (const bId of B_IDS) for (const p of platesOf(bId)) for (const u of p.units) {
  const key = typeKey(bId, p.id, u.slot);
  const list = u.list.map(r => ({ kind: r.kind, name: r.name, nk: r.nk, area: r.area, level: 0, ...(r.kitchen ? { kitchen: true } : {}) }));
  const outs = list.filter(r => OUTDOOR.has(r.kind));
  const util = sum(list.filter(r => !OUTDOOR.has(r.kind)).map(r => r.area));
  const total = u.total ?? +(util + sum(outs.map(r => r.area))).toFixed(2);
  TYPES[key] = { key, building: bId, plate: p.id, slot: u.slot, rooms: u.rooms, label: `${u.rooms}-кімнатна · ${fmtUk(total)} м²`,
    total, living: u.living ?? null, util, outdoor: sum(outs.map(r => r.area)), built: null, outdoorKind: outs[0]?.kind ?? null,
    duplex: false, est: !!u.est || u.total == null, list, plan: planOf(list) };
}

// ---------- Units ----------
const DOOR_MARGIN = 0.475;                                               // half a 0.95 m door leaf (see notes/T02.md, deviations)
const FRAME = { '0,1': r => ({ o: [r.x0, r.z0], U: [1, 0], V: [0, 1], w: r.x1 - r.x0, d: r.z1 - r.z0 }),
  '0,-1': r => ({ o: [r.x1, r.z1], U: [-1, 0], V: [0, -1], w: r.x1 - r.x0, d: r.z1 - r.z0 }),
  '1,0': r => ({ o: [r.x0, r.z1], U: [0, -1], V: [1, 0], w: r.z1 - r.z0, d: r.x1 - r.x0 }),
  '-1,0': r => ({ o: [r.x1, r.z0], U: [0, 1], V: [-1, 0], w: r.z1 - r.z0, d: r.x1 - r.x0 }) };
const SEG = { '0,-1': 'zn', '1,0': 'xp', '0,1': 'zp', '-1,0': 'xn' };
const facingOf = az => 'NESW'[Math.round(az / 90) % 4];
function worldDir(bId, [vx, vz]) { const r = BUILDINGS[bId].rotY; return [vx * Math.cos(r) + vz * Math.sin(r), -vx * Math.sin(r) + vz * Math.cos(r)]; }
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

export const UNITS = [];
export const BLOCKS = [];      // non-residential blocks of the floor plates (cafe, supermarket, fitness, pool, lobby, service rooms, ramps)
(function build() {
  for (const bId of B_IDS) {
    let seq = 1;
    for (const floor of floorsOf(bId)) {
      const p = plateOf(bId, floor); if (!p) continue;
      for (const s of p.units) {
        const key = typeKey(bId, p.id, s.slot), T = TYPES[key], n = s.door.n;
        const f = (FRAME[n.join()] || FRAME['0,1'])(s.rect);
        const width = +f.w.toFixed(3), depth = +f.d.toFixed(3);
        const du = (s.door.p[0] - f.o[0]) * f.U[0] + (s.door.p[1] - f.o[1]) * f.U[1];
        const doorU = width >= 2 * DOOR_MARGIN ? +Math.max(DOOR_MARGIN, Math.min(width - DOOR_MARGIN, du)).toFixed(3) : +(width / 2).toFixed(3);
        const frame = { o: f.o, U: f.U, V: f.V }, door = { u: doorU };
        const facades = s.facades.length ? s.facades : [f.V];
        const az = facades.map(v => bearingOf(...worldDir(bId, v)));
        const run = s.run ? { ...s.run } : { axis: n[0] ? 'z' : 'x', c: n[0] ? s.door.p[0] : s.door.p[1], side: n[0] ? -n[0] : -n[1] };
        const unit = {
          id: `${bId}-${floor}-${pad2(s.slot)}`, building: bId, floor, plate: p.id,
          index: s.slot, apNo: s.no ?? seq, no: s.no ?? null,
          type: key, rooms: s.rooms, area: T.total,
          frame, width, depth, door,
          center: [+((s.rect.x0 + s.rect.x1) / 2).toFixed(3), +((s.rect.z0 + s.rect.z1) / 2).toFixed(3)],
          rect: s.rect, poly: s.poly, bbox: s.bbox, tag: s.tag,
          facades, frontFacade: facades.some(v => same(v, f.V)),
          sideFacades: { left: facades.some(v => same(v, [-f.U[0] || 0, -f.U[1] || 0])), right: facades.some(v => same(v, f.U)) },
          facing: facingOf(az[0]), azimuth: Math.round(az[0]) % 360, facings: [...new Set(az.map(facingOf))],
          outdoor: s.outdoor,
          run, doorA: s.doorA ?? (run.axis === 'x' ? s.door.p[0] : s.door.p[1]), doorP: s.door.p,
          stair: 1, seg: SEG[f.V.join()],
          price: 0, ppm: 0, priceSource: 'rooms', status: 'available',
          walk: !!s.walk, fit: s.fit ?? (s.walk ? 1 : 0), est: !!s.est,
          cframe: frame, cdoor: door,
        };
        if (s.pos != null) unit.pos = s.pos; if (s.stack) unit.stack = s.stack;
        seq++;
        UNITS.push(unit);
      }
      for (const b of p.blocks) BLOCKS.push({ id: b.id, building: bId, floor, kind: b.kind, label: b.label, area: b.area, poly: b.poly, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1,
        frame: { o: [b.x0, b.z0], U: [1, 0], V: [0, 1] }, width: +(b.x1 - b.x0).toFixed(3), depth: +(b.z1 - b.z0).toFixed(3), seg: null, ...(b.est ? { est: true } : {}) });
    }
  }
})();
// Apply the price table and SALES to every unit. Call again after SALES.units was changed at run time (CRM, tests).
export function applySales(table) {
  if (table && table !== SALES) { SALES.units = table.units || table; if (table.updatedAt !== undefined) SALES.updatedAt = table.updatedAt; }
  for (const u of UNITS) {
    u.ppm = pricePerM2(u); u.price = priceOf(u); u.priceSource = priceSourceOf(u);
    const st = SALES.units[u.id]?.status; u.status = STATUSES.includes(st) ? st : 'available';
  }
  return UNITS;
}
applySales();

const _byId = new Map(UNITS.map(u => [u.id, u]));
const _byFloor = new Map(); for (const u of UNITS) { const k = u.building + '|' + u.floor; (_byFloor.get(k) || _byFloor.set(k, []).get(k)).push(u); }
const _blocksByFloor = new Map(); for (const b of BLOCKS) { const k = b.building + '|' + b.floor; (_blocksByFloor.get(k) || _blocksByFloor.set(k, []).get(k)).push(b); }
export const unitById = id => _byId.get(id);
export const unitsOn = (bId, floor) => _byFloor.get(bId + '|' + floor) || [];
export const blocksOn = (bId, floor) => _blocksByFloor.get(bId + '|' + floor) || [];
// unit whose real outline (fallback: 3D rect) contains the building-local point, or null
export function unitAtPoint(bId, floor, x, z) {
  for (const u of unitsOn(bId, floor)) {
    if (u.poly && u.poly.length >= 3) { if (x >= u.bbox.x0 && x <= u.bbox.x1 && z >= u.bbox.z0 && z <= u.bbox.z1 && pointInPoly(u.poly, x, z)) return u; }
    else if (x >= u.rect.x0 && x <= u.rect.x1 && z >= u.rect.z0 && z <= u.rect.z1) return u;
  }
  return null;
}
export function unitLabel(u) { return `Будинок ${BUILDINGS[u.building].no} · поверх ${u.floor} · кв. ${u.apNo}`; }   // Ukrainian; UI uses i18n unitLabelL
// Unit-local (u along the entrance wall, v from the entrance wall into the flat) → building-local (x, z)
export function unitToLocal(unit, uu, vv) { const f = unit.frame; return [f.o[0] + f.U[0] * uu + f.V[0] * vv, f.o[1] + f.U[1] * uu + f.V[1] * vv]; }
export function unitToWorld(unit, uu, vv) { const [x, z] = unitToLocal(unit, uu, vv); return localToWorld(unit.building, x, z); }
// Yaw (radians, three.js rotation.y) that maps unit-local axes (x = u, z = v) onto building-local axes
export function unitYaw(unit) { const [vx, vz] = unit.frame.V; return Math.atan2(vx, vz); }

export function buildingCenter(bId) {                                    // world [x, z] of the typical plate's bbox centre
  const o = footprintOf(bId); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return localToWorld(bId, (x0 + x1) / 2, (z0 + z1) / 2);
}
// first building, a floor of its typical plate that has units (the one nearest to floor 5)
export const DEFAULT_SEL = (() => {
  for (const b of B_IDS) { const fl = (typicalPlate(b)?.floors || []).filter(f => unitsOn(b, f).length); if (fl.length) return { b, f: fl.reduce((m, f) => (Math.abs(f - 5) < Math.abs(m - 5) ? f : m)) }; }
  const u = UNITS[0]; return u ? { b: u.building, f: u.floor } : { b: B_IDS[0], f: 1 };
})();

// ---------- Site (world coordinates) ----------
const bboxOf = pts => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
export const PLOT = SITE.plot;
export const STREETS = SITE.streets;
export const CONTEXT_BLOCKS = SITE.context.map(c => ({ ...c, ...bboxOf(c.poly), tone: 'beige', phase: 'ctx', est: !!c.est }));
export const PODIUM = SITE.podium;
export const COURTYARD = SITE.courtyard;
export const SITE_CENTER = SITE.courtyard.center;
export const PARKING = { ...SITE.parking, ...bboxOf(SITE.parking.poly) };
export const BASEMENT = bboxOf(SITE.parking.poly);                       // LEGACY = bbox of PARKING
export const RAMPS = SITE.parking.ramps;
export const RAMP = RAMPS[0] ? { x0: RAMPS[0].x0, x1: RAMPS[0].x1, z0: RAMPS[0].z0, z1: RAMPS[0].z1, open: RAMPS[0].open, axis: RAMPS[0].axis, top: RAMPS[0].top } : null;   // LEGACY
export const SITE_EXTRAS = SITE.extras;
export const LANDMARKS = [];   // none for this project
export const LAKE = null;      // there is no lake
export const SPIRAL = null;    // no spiral ramp

// ---------- Legacy exports (CONTRACT §1.9, §1.13) — forbidden in new code ----------
export const GEOM = { balconyDepth: 1.5, corridorHalf: 0.9, unitDepth: null, barLength: null, depth: null, wing: null };
export const FOOTPRINT = footprintOf(B_IDS[0]);
export const CORRIDORS = corridorsOf(B_IDS[0]);
export const CORES = coresOf(B_IDS[0]);
export const stairFor = () => 1;
export const isMirrored = () => false;
export const canonToLocal = (b, x, z) => [x, z];
