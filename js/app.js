// ЖК VILNYI (Ужгород) — app shell: wires i18n, sections, finder (plan / list / filters), unit sheet, booking,
// hero 3D (lazy) and the walkthrough overlay (lazy import of ./three/walk.js).
// Nothing here knows how many buildings there are, how tall they are or what a flat costs: everything comes from
// data.js. Sibling modules (plan.js, booking.js, hero3d.js) are imported dynamically, so a broken or missing one
// degrades its own feature only (CONTRACT §0 rule 6, §8) — the page, the list and the unit sheet keep working.
import { PROJECT, TYPES, UNITS, BUILDINGS, B_IDS, DEFAULT_SEL, TOP_FLOOR, PLOT, STREETS, PODIUM, CONTEXT_BLOCKS, COMPASS, PRICE_RANGE,
  floorsOf, topFloor, floorY, roofY, floorLabel, unitsOn, blocksOn, unitById, localToWorld, footprintOf, money } from './data.js';
import { t, pick, planText, num, setLang, lang, dir, onLangChange, initialLang, i18nApi, LANGS, langInfo, unitLabelL } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// T32: no WebGL on this device → the walkthrough and the live 3D are switched off for this visit (buttons are not shown,
// nothing 3D is loaded); plans, sheets, the calculator and booking are unaffected.
const GL_OK = (() => { try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch (e) { return false; } })();
const F = { ...(PROJECT.features || {}) };
if (!GL_OK) { F.walk = false; F.hero3d = false; }
const pad2 = n => String(n).padStart(2, '0');
const r1 = n => +(+n).toFixed(1);

// ---------------------------------------------------------------- sibling modules (optional at link time)
// Filled by loadSiblings() before the first render. Every use goes through the guards below.
let PL = null, BK = null, H3 = null;
async function loadSiblings() {
  const soft = (name, p) => p.catch(e => { console.warn(`[app] ${name} is not available:`, e); return null; });
  [PL, BK, H3] = await Promise.all([soft('plan.js', import('./plan.js')), soft('booking.js', import('./booking.js')),
    F.hero3d === false ? null : soft('hero3d.js', import('./hero3d.js'))]);
}
// CONTRACT §5: 'reserved' → 'is-res', 'sold' | 'blocked' → 'is-sold', else 'is-avail'
const statusClass = s => (s === 'reserved' ? 'is-res' : s === 'sold' || s === 'blocked' ? 'is-sold' : 'is-avail');
const svgFrom = (fn, u) => { try { const s = PL?.[fn]?.(u); return typeof s === 'string' ? s : ''; } catch (e) { console.warn(`[app] ${fn}:`, e); return ''; } };
async function copyText(text) {
  if (BK?.copyText) return BK.copyText(text);
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}
function bindCopy(root) {
  if (BK?.bindCopy) return BK.bindCopy(root);
  root.querySelectorAll('[data-copy]').forEach(btn => {
    if (btn._copyBound) return; btn._copyBound = true;
    btn.addEventListener('click', async () => {
      const ok = await copyText((document.getElementById(btn.dataset.copy)?.textContent ?? '').trim());
      const l = btn.querySelector('.copy-l') || btn; const old = l.textContent; l.textContent = ok ? t('bk.copied') : '—'; setTimeout(() => (l.textContent = old), 1600);
    });
  });
}
// CONTRACT §3.1 booking.js planBreakdown(price, plan, {discountPct}); the local formula is the same one and is used when
// booking.js is missing or returns something else.
function breakdown(price, plan, discountPct = 0) {
  try { const r = BK?.planBreakdown?.(price, plan, { discountPct }); if (r && [r.net, r.first, r.rest, r.monthly].every(Number.isFinite)) return r; } catch (e) { /* fall through */ }
  const net = price * (1 - discountPct / 100), first = net * plan.split[0] / 100, rest = net - first, months = plan.months || 0;
  return { price, discountPct, discount: price - net, net, first, rest, months, monthly: months ? rest / months : 0 };
}

// ---------------------------------------------------------------- texts
// Keys the dictionaries do not have yet (see notes/T05.md "KEYS FOR I18N"). tx() prefers the dictionaries, so the
// local copy drops out by itself once a key is added there.
const LX = {
  uk: {
    'price.from': 'від {v}', 'finder.area': 'Площа', 'finder.minArea': 'Площа від', 'finder.maxArea': 'Площа до', 'finder.status': 'Статус',
    'unit.priceSrc.table': 'Ціна орієнтовна: її розраховано за вартістю м² із публічного оголошення про продаж. Точну вартість уточнюйте у відділі продажу.',
    'unit.priceSrc.list': 'Ціна за прайс-листом відділу продажу.',
    'facts.perListing': 'за даними публічного оголошення', 'facts.customer': 'Замовник будівництва',
  },
  en: {
    'price.from': 'from {v}', 'finder.area': 'Area', 'finder.minArea': 'Area from', 'finder.maxArea': 'Area to', 'finder.status': 'Status',
    'unit.priceSrc.table': 'Indicative price: calculated from the price per m² in the public sales listing. Please confirm the exact price with the sales office.',
    'unit.priceSrc.list': 'Price from the sales office price list.',
    'facts.perListing': 'per the public listing', 'facts.customer': 'Customer',
  },
  he: {
    'price.from': 'החל מ-{v}', 'finder.area': 'שטח', 'finder.minArea': 'שטח מ-', 'finder.maxArea': 'שטח עד', 'finder.status': 'סטטוס',
    'unit.priceSrc.table': 'מחיר משוער: מחושב לפי המחיר למ״ר מהמודעה הפומבית למכירה. את המחיר המדויק יש לברר במשרד המכירות.',
    'unit.priceSrc.list': 'מחיר לפי מחירון משרד המכירות.',
    'facts.perListing': 'לפי המודעה הפומבית', 'facts.customer': 'מזמין הבנייה',
  },
  ru: {
    'price.from': 'от {v}', 'finder.area': 'Площадь', 'finder.minArea': 'Площадь от', 'finder.maxArea': 'Площадь до', 'finder.status': 'Статус',
    'unit.priceSrc.table': 'Цена ориентировочная: рассчитана по стоимости м² из публичного объявления о продаже. Точную стоимость уточняйте в отделе продаж.',
    'unit.priceSrc.list': 'Цена по прайс-листу отдела продаж.',
    'facts.perListing': 'по данным публичного объявления', 'facts.customer': 'Заказчик строительства',
  },
  ro: {
    'price.from': 'de la {v}', 'finder.area': 'Suprafață', 'finder.minArea': 'Suprafață de la', 'finder.maxArea': 'Suprafață până la', 'finder.status': 'Stare',
    'unit.priceSrc.table': 'Preț orientativ: calculat după prețul pe m² din anunțul public de vânzare. Prețul exact se confirmă la biroul de vânzări.',
    'unit.priceSrc.list': 'Preț conform listei de prețuri a biroului de vânzări.',
    'facts.perListing': 'conform anunțului public', 'facts.customer': 'Beneficiar',
  },
  de: {
    'price.from': 'ab {v}', 'finder.area': 'Fläche', 'finder.minArea': 'Fläche ab', 'finder.maxArea': 'Fläche bis', 'finder.status': 'Status',
    'unit.priceSrc.table': 'Richtpreis: berechnet nach dem Quadratmeterpreis aus dem öffentlichen Verkaufsinserat. Den genauen Preis nennt Ihnen das Verkaufsbüro.',
    'unit.priceSrc.list': 'Preis laut Preisliste des Verkaufsbüros.',
    'facts.perListing': 'laut öffentlichem Inserat', 'facts.customer': 'Bauherr',
  },
  fr: {
    'price.from': 'dès {v}', 'finder.area': 'Surface', 'finder.minArea': 'Surface min.', 'finder.maxArea': 'Surface max.', 'finder.status': 'Statut',
    'unit.priceSrc.table': 'Prix indicatif : calculé d’après le prix au m² de l’annonce publique de vente. Le prix exact est à confirmer auprès du bureau de vente.',
    'unit.priceSrc.list': 'Prix selon la grille tarifaire du bureau de vente.',
    'facts.perListing': 'selon l’annonce publique', 'facts.customer': 'Maître d’ouvrage',
  },
  it: {
    'price.from': 'da {v}', 'finder.area': 'Superficie', 'finder.minArea': 'Superficie da', 'finder.maxArea': 'Superficie fino a', 'finder.status': 'Stato',
    'unit.priceSrc.table': 'Prezzo indicativo: calcolato in base al prezzo al m² dell’annuncio pubblico di vendita. Il prezzo esatto va confermato con l’ufficio vendite.',
    'unit.priceSrc.list': 'Prezzo da listino dell’ufficio vendite.',
    'facts.perListing': 'secondo l’annuncio pubblico', 'facts.customer': 'Committente',
  },
};
function tx(key, vars) {
  let s = t(key, vars); if (s !== key) return s;
  s = LX[lang]?.[key] ?? LX.uk[key] ?? LX.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}
const has = key => t(key) !== key;                       // is the key in a dictionary?
const roomsText = n => (n === 1 ? t('rooms.1') : t('rooms.n', { n }));
const floorText = f => t('unit.floor', { n: floorLabel(f) });
const bldText = b => `${t('ul.building')} ${BUILDINGS[b].no}`;
const commaLang = () => lang === 'uk' || lang === 'ru';
const m2 = () => (commaLang() ? 'м²' : 'm²');
// CONTRACT §2: "34,50 м²" in uk and ru (decimal comma), "34.50 m²" otherwise
const fmtArea = n => { const s = (+n).toFixed(2); return (commaLang() ? s.replace('.', ',') : s) + ' ' + m2(); };
const facingText = u => (u.facings?.length ? u.facings : [u.facing]).map(c => t('face.' + c)).join(' / ');
const unitCode = u => `${BUILDINGS[u.building].no}-${floorLabel(u.floor)}-${pad2(u.index)}`;
function deliveryText(b, tbc = true) {
  const d = BUILDINGS[b]?.delivery; if (!d) return '';
  return t('delivery.q', { q: d.q, y: d.year }) + (d.confirmed || !tbc ? '' : ' · ' + t('delivery.tbc'));
}
const fmtPhone = p => { const m = String(p).match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/); return m ? `+38 0${m[1]} ${m[2]} ${m[3]} ${m[4]}` : String(p); };
const fmtDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || ''); };
const clampFloor = (b, f) => Math.max(1, Math.min(topFloor(b) || 1, Math.round(+f) || 1));

// ---------------------------------------------------------------- state
const reserved = new Set();
const fltDefault = () => ({ rooms: '', facing: '', status: '', pmin: 0, pmax: 0, amin: 0, amax: 0, fmin: 1, fmax: TOP_FLOOR });
const S = {
  b: BUILDINGS[DEFAULT_SEL.b] ? DEFAULT_SEL.b : B_IDS[0], f: DEFAULT_SEL.f, view: 'plan', sort: 'price', limit: 30,
  flt: fltDefault(),
  styleId: lsGet('vrc.style', 'milano'),
  unit: null, calcPlan: PROJECT.terms.plans[0]?.id, calcDisc: '', timeMode: 'dusk',
};
const statusOf = u => (reserved.has(u.id) ? 'reserved' : u.status);
const STYLES = ['milano', 'nordic', 'riviera', 'monaco', 'kyoto', 'paris'];
// designs without their own renders borrow the nearest rendered design's stills (veil / gallery)
const STILL_STYLE = { monaco: 'milano', kyoto: 'nordic', paris: 'riviera' };
const canWalk = u => !!(F.walk && u && u.walk);

// Styles for the markup only this module produces (site map, elevation, sheet notes). They use the :root palette of
// css/site.css; the page owner may move them there (notes/T05.md).
function appStyles() {
  if (document.getElementById('appCss')) return;
  const st = document.createElement('style'); st.id = 'appCss';
  st.textContent = `
.bld-tabs button{flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 4px;min-width:0}
.bld-tabs .tb-s{font-size:9px;letter-spacing:.14em}
.fl.none{opacity:.55}.fl.none .fl-bar i{width:0}
.dot.sold{background:var(--st-sold,#6d6558)}
.ev2-t{font:600 4.4px/1 var(--f-body);fill:var(--gold);letter-spacing:.2px}
.ev2-n{font:500 5.6px/1 "Cormorant Garamond",serif;fill:var(--muted);text-anchor:middle;pointer-events:none}
.ev-b{opacity:.5;transition:opacity .3s}.ev-b.cur{opacity:1}.ev-b.cur .ev2-n{fill:var(--gold-hi)}
.sh-num{margin:8px 0 0;font-size:12px;color:var(--dim)}
.sh-plan{margin-top:22px}.sh-plan .h5{margin-bottom:10px}
.unitplan-wrap{border:1px solid var(--line);background:#f4f1ea;overflow:hidden}
.unitplan-wrap svg{display:block;width:100%;height:auto;max-height:56vh}
.sh-key.solo{grid-template-columns:minmax(0,1fr)}
.sh-acts:empty{display:none}
.calc-k{margin:14px 0 8px;font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
:lang(he) .calc-k{letter-spacing:.03em;font-size:13px}
.cr.strong b{color:var(--gold-hi)}.cr.minus b{color:var(--ok,#9fbf8f)}
.tile-v.long{font-size:34px;line-height:1.15}
.tile-d b{font-weight:500;color:var(--text)}
.sitemap .sm-land{fill:#0f0e0b}
.sitemap .sm-st{fill:none;stroke:#221f19;stroke-linecap:round;stroke-linejoin:round}
.sitemap .sm-st.main{stroke:#2c2820}
.sitemap .sm-ctx{fill:#1a1814;stroke:rgba(243,237,225,.1);stroke-width:.3}
.sitemap .sm-plot{fill:rgba(201,169,106,.07);stroke:var(--gold-lo,#8a7245);stroke-width:.5;stroke-dasharray:2.4 1.6}
.sitemap .sm-pod{fill:#3a3226;stroke:rgba(232,204,145,.45);stroke-width:.35}
.sitemap .sm-b{fill:var(--gold);stroke:var(--gold-hi);stroke-width:.4;cursor:pointer;transition:fill .25s}
.sitemap .sm-bg:hover .sm-b,.sitemap .sm-bg:focus-visible .sm-b{fill:var(--gold-hi)}
.sitemap .sm-bg{outline:none}
.sitemap .sm-bn{font:600 9px/1 "Cormorant Garamond",serif;fill:#17130c;text-anchor:middle;pointer-events:none}
.sitemap .sm-pm circle{fill:#0f0e0b;stroke:var(--gold-hi);stroke-width:.35}
.sitemap .sm-pm text{font:600 4.4px/1 var(--f-body);fill:var(--gold-hi);text-anchor:middle}
.sitemap .sm-sn{font:500 4.6px/1 var(--f-body);fill:var(--muted);text-anchor:middle;paint-order:stroke;stroke:#0f0e0b;stroke-width:1.1px;stroke-linejoin:round}
.sitemap .sm-sn.min{font-size:3.8px;fill:var(--dim)}
.sitemap .sm-north circle{fill:rgba(15,14,11,.8);stroke:rgba(201,169,106,.5);stroke-width:.35}
.sitemap .sm-north path{fill:var(--gold)}
.sitemap .sm-north text{font:600 4.6px/1 var(--f-body);fill:var(--gold-hi);text-anchor:middle}
.sitemap .sm-scale path{fill:none;stroke:var(--muted);stroke-width:.5}
.sitemap .sm-scale text{font:500 4.2px/1 var(--f-body);fill:var(--muted);text-anchor:middle}
@media (max-width:600px){.sitemap .sm-sn{font-size:6px}.sitemap .sm-sn.min{font-size:5px}.sitemap .sm-pm text,.sitemap .sm-north text,.sitemap .sm-scale text{font-size:5.6px}.sitemap .sm-bn{font-size:11px}}
.map figcaption{display:grid;gap:8px}
.sm-leg{display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--muted)}
.sm-leg span{display:inline-flex;align-items:center;gap:7px}
.sm-leg i{width:11px;height:11px;flex:none;background:var(--gold)}
.sm-leg b{display:inline-grid;place-items:center;width:17px;height:17px;border:1px solid var(--gold-hi);border-radius:50%;font-size:10px;font-weight:600;color:var(--gold-hi)}
@media (min-width:1100px){#amenities.am-6{grid-template-columns:repeat(3,1fr);border-bottom:0}
#amenities.am-6 .am{border-bottom:1px solid var(--line)}
#amenities.am-6 .am:nth-child(3n+1){border-inline-start:0;padding-inline-start:0}}`;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------- static-ish sections
const ICON = {
  green: '<path d="M12 21v-7M12 14c-3.5 0-6-2.3-6-5.3C6 5.5 8.7 3 12 3s6 2.5 6 5.7c0 3-2.5 5.3-6 5.3zM9 10.5l3 2.2 3-3.2M4 21h16"/>',
  shops: '<path d="M5 8h14l-1.2 12.5H6.2zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  parking: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.5 17V7.5h3.3a2.8 2.8 0 0 1 0 5.6H9.5"/>',
  kinder: '<path d="M4 20V10l8-6 8 6v10zM9.5 20v-5h5v5M12 8.3v.2"/><circle cx="12" cy="11" r="1.2"/>',
  spa: '<path d="M3 16.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0M3 20.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0M8.5 13V6a2 2 0 0 1 4 0M14.5 13V6a2 2 0 0 1 4 0M8.5 9.5h6"/>',
  shelter: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6zM13 7.5l-3 5h4l-3 4.5"/>',
};
const AMENITIES = [['shops', 'life.market'], ['kinder', 'life.playland'], ['spa', 'life.spa'], ['parking', 'life.parking'], ['shelter', 'life.shelter'], ['green', 'life.yard']];

function renderStatic() {
  const P = PROJECT, T = P.terms, tot = P.totals, C = P.contact || {};
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };

  // T32: the price tile is "from 47 450 ₴" — the words around the number are set small beside it (they made the tile wrap
  // in every language); the number itself stays LTR, the words follow the page direction.
  const [fromPre, fromPost = ''] = tx('price.from', { v: '\u0001' }).replace(/[\u2066-\u2069\u200e\u200f]/g, '').split('\u0001').map(x => x.trim());
  const sm = x => (x ? `<small class="stat-pre">${esc(x)}</small>` : '');
  set('#heroStats', [
    [num(tot.apartments), 'hero.stat.units'], [num(tot.parking), 'hero.stat.parking'],
    [num(tot.buildings), 'hero.stat.buildings'], [money(PRICE_RANGE.min), 'hero.stat.price', fromPre, fromPost],
  ].map(([v, k, pre, post]) => `<div class="stat"><p class="stat-v">${sm(pre)}<b dir="ltr">${esc(v)}</b>${sm(post)}</p><span>${esc(t(k))}</span></div>`).join(''));

  const am = AMENITIES.filter(([, k]) => has(k + '.t'));
  set('#amenities', am.map(([ic, k], i) => `<li class="am"><svg class="am-ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[ic]}</svg><span class="am-n" aria-hidden="true">${pad2(i + 1)}</span><h3 class="h5">${esc(t(k + '.t'))}</h3><p>${esc(t(k + '.d'))}</p></li>`).join(''))
    ?.classList.toggle('am-6', am.length === 6);

  // terms tiles: price range, instalments, discount, planned delivery per building
  const inst = T.instalment, discMax = Math.max(0, ...(T.discounts || []).map(d => d.percent || 0));
  const years = [...new Set(B_IDS.map(b => BUILDINGS[b].delivery?.year).filter(Boolean))].sort();
  const tiles = [
    ['terms.price', `${esc(tx('price.from', { v: money(PRICE_RANGE.min) }))}<small>${esc(t('unit.perM2Short'))}</small>`, esc(t('terms.priceD')), 'long'],
  ];
  if (inst) tiles.push(['terms.instT', `<span dir="ltr">${inst.firstPayment[0]}–${inst.firstPayment[1]}%</span><small>${inst.months} ${esc(t('calc.months'))}</small>`, esc(t('terms.instD'))]);
  if (discMax) tiles.push(['terms.discT', `<span dir="ltr">−${discMax}%</span>`, esc(t('terms.discD'))]);
  if (years.length) tiles.push(['terms.deliveryT', `<span dir="ltr">${years.length > 1 ? years[0] + '–' + years[years.length - 1] : years[0]}</span>`,
    B_IDS.filter(b => BUILDINGS[b].delivery).map(b => `<b>${esc(bldText(b))}</b> — ${esc(deliveryText(b, false))}`).join('<br>') +
      (B_IDS.some(b => BUILDINGS[b].delivery && !BUILDINGS[b].delivery.confirmed) ? `<br>(${esc(t('delivery.tbc'))})` : '')]);
  set('#termsGrid', tiles.map(([k, v, d, cls]) => `<div class="tile"><p class="tile-k">${esc(t(k))}</p><p class="tile-v${cls ? ' ' + cls : ''}">${v}</p><p class="tile-d">${d}</p></div>`).join(''));

  const sp = T.statePrograms; const noPrograms = sp && !sp.eOselya && !sp.eVidnovlennia && has('terms.programs');
  set('#plansRow', T.plans.map((p, i) => `<article class="plan-card"><span class="pc-idx">${pad2(i + 1)}</span><h3 class="h4">${esc(planText(p))}</h3>
      <div class="split" dir="ltr" aria-hidden="true">${p.split[0] ? `<i style="flex:${p.split[0]}"><span>${p.split[0]}%</span></i>` : ''}${p.split[1] ? `<i class="b" style="flex:${p.split[1]}"><span>${p.split[1]}%</span></i>` : ''}</div>
      <p>${esc(planText(p, 'desc'))}</p></article>`).join('') +
    `<article class="plan-card contract"><span class="pc-idx">§</span><h3 class="h4">${esc(t('terms.contract'))}</h3><p>${esc(t('terms.contract.text'))}</p>${noPrograms ? `<p class="fine">${esc(t('terms.programs'))}</p>` : ''}</article>`);

  // facts: values are the dictionaries' own texts where PROJECT.facts holds a code; rows with no value are skipped
  const fx = P.facts || {}, tv = k => (has(k) ? t(k) : ''), listed = v => (v ? `${v} — ${tx('facts.perListing')}` : '');
  const facts = [
    ['facts.developer', P.developer], ['facts.class', P.class && tv('facts.classV')],
    ['facts.buildings', tv('facts.buildingsV') || num(tot.buildings)], ['facts.apartments', num(tot.apartments)], ['facts.parking', num(tot.parking)],
    ['facts.plot', tot.plotHa && tv('facts.plotV')],
    ['facts.tech', fx.tech && tv('facts.techV')], ['facts.walls', fx.walls && tv('facts.wallsV')], ['facts.insulation', fx.insulation && tv('facts.insulationV')],
    ['facts.heating', fx.heating && tv('facts.heatingV')], ['facts.ceiling', fx.ceiling && tv('facts.ceilingV')],
    ['facts.power', fx.generator && tv('facts.powerV')], ['facts.shelter', fx.shelter && tv('facts.shelterV')],
    ['facts.permit', fx.permit?.number && t('facts.permitV', { n: fx.permit.number, d: fmtDate(fx.permit.date) })],
    ['facts.contractor', listed(fx.contractor?.name)], ['facts.customer', listed(fx.customer?.name)], ['facts.cadastral', listed(fx.cadastral?.number)],
  ].filter(([, v]) => v);
  set('#factsGrid', facts.map(([k, v]) => `<div class="fact"><dt>${esc(tx(k))}</dt><dd dir="auto">${esc(v)}</dd></div>`).join(''));
  const dev = P.developer || P.partner?.name || '';
  set('#partnerCard', `<img class="pc-logo" src="assets/brand/vilnyi-logo-new.svg" alt="${esc(dev)}" width="413" height="166" loading="lazy"><div><p class="eyebrow">${esc(t('facts.partner'))}</p>
    <p class="pc-name" dir="ltr">${esc(dev)}</p><p class="pc-role">${esc(t('terms.partner.role'))}</p>
    ${/^https?:\/\//.test(C.site || '') ? `<a class="pc-link" href="${esc(C.site)}" target="_blank" rel="noopener" dir="ltr">${esc(String(C.site).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}</div>`)
    ?.querySelector('img')?.addEventListener('error', e => e.target.remove(), { once: true });
  set('#locPts', ['loc.pt1', 'loc.pt2', 'loc.pt3', 'loc.pt4'].filter(has).map(k => `<li>${esc(t(k))}</li>`).join(''));

  // address + contacts (copyable text; links are conveniences only). Empty values are skipped.
  const addr = tv('loc.addressV') || pick(P.address);            // dictionary form first (8 languages), data.js as the fallback
  set('#addr', `<p class="addr-k">${esc(t('loc.address'))}</p><p class="addr-v" id="addrV" dir="auto">${esc(addr)}</p><button type="button" class="copy" data-copy="addrV"><span class="copy-l">${esc(t('bk.copy'))}</span></button>`);
  const digits = s => String(s).replace(/[^\d]/g, ''), host = u => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const hours = tv('foot.hoursV') || Object.entries(C.hours || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');
  const items = [];   // [label, value, href | null, ltr]
  if (C.phone) items.push([tx('foot.phone'), fmtPhone(C.phone), `tel:+${digits(C.phone)}`, true]);
  if (C.viber) items.push([tx('foot.viber'), fmtPhone(C.viber), `viber://chat?number=%2B${digits(C.viber)}`, true]);
  if (C.whatsapp) items.push([t('bk.c.whatsapp'), fmtPhone(C.whatsapp), `https://wa.me/${digits(C.whatsapp)}`, true]);
  if (C.email) items.push([tx('foot.email'), C.email, `mailto:${C.email}`, true]);
  if (C.site) items.push([tx('foot.site'), host(C.site), C.site, true]);
  if (pick(C.office)) items.push([tx('foot.office'), tv('foot.officeV') || pick(C.office), null, false]);
  if (hours) items.push([tx('foot.hours'), hours, null, false]);
  items.push([t('loc.address'), addr, null, false]);
  set('#contactList', (C.phone || C.viber || C.email ? '' : `<p class="muted small">${esc(t('foot.noContact'))}</p>`) +
    items.map(([k, v, href, ltr], i) => `<div class="ct"><span class="ct-k">${esc(k)}</span>${href
      ? `<a class="ct-v" id="ct${i}" href="${esc(href)}" dir="ltr" target="_blank" rel="noopener">${esc(v)}</a>`
      : `<span class="ct-v" id="ct${i}" dir="${ltr ? 'ltr' : 'auto'}">${esc(v)}</span>`}<button type="button" class="copy" data-copy="ct${i}"><span class="copy-l">${esc(t('bk.copy'))}</span></button></div>`).join(''));
  const cr = $('#copyright'); if (cr) cr.textContent = t('foot.rights', { y: new Date().getFullYear() });
  renderMap();
  bindCopy(document);
}

// ---------------------------------------------------------------- location map
// Schematic site map in world metres (x right, z down = the plans' sheet): plot, streets with their names, neighbours,
// podium volumes, the tower footprints and a north arrow from COMPASS. viewBox = plot bbox + 60 m. Nothing is hard-coded.
const bboxOf = pts => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const ptsAttr = poly => poly.map(([x, z]) => `${r1(x)},${r1(z)}`).join(' ');
const inPoly = (p, x, z) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
function distToPoly(p, x, z) {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j][0], az = p[j][1], bx = p[i][0] - ax, bz = p[i][1] - az, l2 = bx * bx + bz * bz || 1e-9;
    const k = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2)); d = Math.min(d, Math.hypot(x - ax - bx * k, z - az - bz * k));
  }
  return d;
}
// Pieces of a polyline inside the rectangle [x0, x1] × [z0, z1] (Liang–Barsky per segment, joined when continuous)
function clipLine(pts, R) {
  const runs = []; let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az; let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - R.x0], [dx, R.x1 - ax], [-dz, az - R.z0], [dz, R.z1 - az]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) ok = false; } else { const r = q / p; if (p < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else if (r < t0) ok = false; else if (r < t1) t1 = r; }
    }
    if (!ok || t1 - t0 < 1e-6) { cur = null; continue; }
    const a = [ax + dx * t0, az + dz * t0], b = [ax + dx * t1, az + dz * t1];
    if (cur && t0 === 0) cur.push(b); else runs.push(cur = [a, b]);
    if (t1 < 1) cur = null;
  }
  return runs;
}
const lineLen = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
function pointAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= l || i === pts.length - 1) { const k = l ? Math.max(0, Math.min(1, d / l)) : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]; }
    d -= l;
  }
  return pts[0];
}
// A point well inside `poly` and outside every polygon of `holes` (coarse pole of inaccessibility)
function labelPoint(poly, holes) {
  const B = bboxOf(poly); let best = null;
  for (let x = B.x0 + 1; x < B.x1; x += 1.5) for (let z = B.z0 + 1; z < B.z1; z += 1.5) {
    if (!inPoly(poly, x, z) || holes.some(h => inPoly(h, x, z))) continue;
    const d = Math.min(distToPoly(poly, x, z), ...holes.map(h => distToPoly(h, x, z)));
    if (!best || d > best.d) best = { x, z, d };
  }
  return best;
}
function mapHTML() {
  const P = bboxOf(PLOT), M = 60;
  const R = { x0: P.x0 - M, x1: P.x1 + M, z0: P.z0 - M, z1: P.z1 + M }, W = R.x1 - R.x0, H = R.z1 - R.z0;
  const name = o => o?.[lang] ?? o?.uk ?? o?.en ?? '';
  const touches = b => b.x1 > R.x0 && b.x0 < R.x1 && b.z1 > R.z0 && b.z0 < R.z1;

  let streets = '', names = ''; const seen = new Set();
  for (const s of [...STREETS].sort((a, b) => (a.main ? 1 : 0) - (b.main ? 1 : 0))) {
    const runs = clipLine(s.pts, R); if (!runs.length) continue;
    const w = s.w || 6;
    for (const run of runs) streets += `<polyline class="sm-st${s.main ? ' main' : ''}" stroke-width="${w}" points="${ptsAttr(run)}"/>`;
    const txt = name(s.name); if (!txt || seen.has(txt)) continue;
    const run = runs.reduce((m, q) => (lineLen(q) > lineLen(m) ? q : m)), len = lineLen(run), fs = s.main ? 4.6 : 3.8, need = txt.length * fs * 0.56 + 8;
    if (len < need) continue;
    // keep the name inside the picture and clear of the corner furniture (north arrow, scale bar)
    const mid = pointAt(run, len / 2), a = pointAt(run, len / 2 - need / 2), b = pointAt(run, len / 2 + need / 2);
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
    seen.add(txt);
    names += `<text class="sm-sn${s.main ? '' : ' min'}" transform="translate(${r1(mid[0])} ${r1(mid[1])}) rotate(${r1(ang)})" dy=".35em">${esc(txt)}</text>`;
  }
  const ctx = CONTEXT_BLOCKS.filter(c => c.poly?.length > 2 && touches(c)).map(c => `<polygon class="sm-ctx" points="${ptsAttr(c.poly)}"/>`).join('');

  const towers = B_IDS.map(b => ({ b, poly: footprintOf(b).map(([x, z]) => localToWorld(b, x, z)) })).filter(q => q.poly.length > 2);
  const pods = PODIUM.filter(p => p.poly?.length > 2).map((p, i) => ({ p, mark: String.fromCharCode(97 + i), at: labelPoint(p.poly, towers.map(q => q.poly)) }));
  const podium = pods.map(({ p }) => `<polygon class="sm-pod" points="${ptsAttr(p.poly)}"/>`).join('');
  const podMarks = pods.filter(q => q.at && q.at.d > 2.2).map(q => `<g class="sm-pm" transform="translate(${r1(q.at.x)} ${r1(q.at.z)})"><circle r="3.6"/><text dy=".36em">${q.mark}</text></g>`).join('');
  const blds = towers.map(({ b, poly }) => {
    const c = bboxOf(poly), label = `${bldText(b)} · ${t('nav.cta')}`;
    return `<g class="sm-bg" data-b="${b}" tabindex="0" role="link" aria-label="${esc(label)}"><title>${esc(label)}</title><polygon class="sm-b" points="${ptsAttr(poly)}"/>
      <text class="sm-bn" x="${r1((c.x0 + c.x1) / 2)}" y="${r1((c.z0 + c.z1) / 2)}" dy=".34em">${BUILDINGS[b].no}</text></g>`;
  }).join('');

  // north: COMPASS.negZ is the true bearing of "up" (−z), so north is that many degrees anticlockwise from up
  const na = -COMPASS.negZ * Math.PI / 180, nx = Math.sin(na), nz = -Math.cos(na), nc = [R.x0 + 17, R.z0 + 19];
  const north = `<g class="sm-north" transform="translate(${r1(nc[0])} ${r1(nc[1])})"><circle r="8.5"/><path transform="rotate(${r1(-COMPASS.negZ)})" d="M0 -11L3 2 0 .4-3 2Z"/><text x="${r1(nx * 15.5)}" y="${r1(nz * 15.5)}" dy=".35em">${esc(t('plan.north'))}</text></g>`;
  const scale = `<g class="sm-scale" transform="translate(${r1(R.x0 + 10)} ${r1(R.z1 - 9)})"><path d="M0 0H50M0 -2.2V2.2M50 -2.2V2.2"/><text x="25" y="-4">${esc(t('loc.scale'))}</text></g>`;

  const legend = [`<span><i></i>${esc(t('finder.building'))} ${towers.map(q => BUILDINGS[q.b].no).join(', ')}</span>`,
    ...pods.filter(q => q.at && q.at.d > 2.2 && name(q.p.label)).map(q => `<span><b>${q.mark}</b>${esc(name(q.p.label))}</span>`)].join('');
  return `<svg class="sitemap" viewBox="${r1(R.x0)} ${r1(R.z0)} ${r1(W)} ${r1(H)}" role="img" aria-label="${esc(PROJECT.name)} — ${esc(pick(PROJECT.address))}" direction="ltr">
    <defs><clipPath id="smClip"><rect x="${r1(R.x0)}" y="${r1(R.z0)}" width="${r1(W)}" height="${r1(H)}"/></clipPath></defs>
    <g clip-path="url(#smClip)">
      <rect class="sm-land" x="${r1(R.x0)}" y="${r1(R.z0)}" width="${r1(W)}" height="${r1(H)}"/>
      ${streets}${ctx}
      <polygon class="sm-plot" points="${ptsAttr(PLOT)}"/>
      ${podium}${blds}${podMarks}${names}${north}${scale}
    </g></svg><figcaption><span class="sm-leg">${legend}</span><span>${esc(t('loc.mapNote'))}</span></figcaption>`;
}
function renderMap() {
  const host = $('#map'); if (!host) return;
  try { host.innerHTML = mapHTML(); host.hidden = false; } catch (e) { console.warn('[app] site map:', e); host.innerHTML = ''; host.hidden = true; }
}
function bindMap() {
  const host = $('#map'); if (!host) return;
  const go = e => {
    const b = e.target.closest?.('[data-b]')?.dataset.b; if (!b || !BUILDINGS[b]) return;
    if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); }
    setFloor(b, clampFloor(b, S.f), { scroll: true });
  };
  host.addEventListener('click', go); host.addEventListener('keydown', go);
}

// ---------------------------------------------------------------- finder
let plan = null;
const NO_PLAN = { show() {}, refresh() {}, applyMatches() {}, select() {}, setMode() {}, get current() { return { b: S.b, f: S.f }; } };
const STEP_PRICE = 250000, STEP_AREA = 10;
function steps(values, step) {
  const lo = Math.floor(Math.min(...values) / step) * step, hi = Math.ceil(Math.max(...values) / step) * step;
  const out = []; for (let v = lo; v <= hi; v += step) out.push(v); return out;
}
const priceSteps = () => steps(UNITS.map(u => u.price), STEP_PRICE);
const areaSteps = () => steps(UNITS.map(u => TYPES[u.type].total), STEP_AREA);
function matches(u, withFloors = false) {
  const f = S.flt, a = TYPES[u.type].total;
  if (f.rooms && u.rooms !== +f.rooms) return false;
  if (f.facing && !(u.facings || [u.facing]).includes(f.facing)) return false;
  if (f.status && statusOf(u) !== f.status) return false;
  if (f.pmin && u.price < f.pmin) return false;
  if (f.pmax && u.price > f.pmax) return false;
  if (f.amin && a < f.amin) return false;
  if (f.amax && a > f.amax) return false;
  if (withFloors && (u.floor < f.fmin || u.floor > f.fmax)) return false;
  return true;
}
function activeFilters() { const f = S.flt; return [f.rooms, f.facing, f.status, f.pmin, f.pmax, f.amin, f.amax, f.fmin > 1 || f.fmax < TOP_FLOOR].filter(Boolean).length; }

function renderFilters() {
  const f = S.flt, ps = priceSteps(), as = areaSteps();
  const chip = (name, v, label, cur) => `<label class="chip"><input type="radio" name="${name}" value="${v}" ${String(cur) === String(v) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  const opt = (v, label, cur) => `<option value="${v}" ${+cur === v ? 'selected' : ''}>${esc(label)}</option>`;
  const floors = Array.from({ length: TOP_FLOOR }, (_, i) => i + 1);
  const roomSet = [...new Set(UNITS.map(u => u.rooms))].sort();
  $('#filters').innerHTML = `
    <fieldset class="fg"><legend>${esc(t('finder.rooms'))}</legend><div class="chips">${chip('rooms', '', t('finder.any'), f.rooms)}${roomSet.map(r => chip('rooms', r, r, f.rooms)).join('')}</div></fieldset>
    <fieldset class="fg"><legend>${esc(tx('finder.area'))}</legend><div class="sel2">
      <select name="amin" aria-label="${esc(tx('finder.minArea'))}">${opt(0, tx('finder.minArea'), f.amin)}${as.slice(0, -1).map(v => opt(v, `${v} ${m2()}`, f.amin)).join('')}</select>
      <span aria-hidden="true">–</span>
      <select name="amax" aria-label="${esc(tx('finder.maxArea'))}">${opt(0, tx('finder.maxArea'), f.amax)}${as.slice(1).map(v => opt(v, `${v} ${m2()}`, f.amax)).join('')}</select></div></fieldset>
    <fieldset class="fg"><legend>${esc(t('finder.price'))}</legend><div class="sel2">
      <select name="pmin" aria-label="${esc(t('finder.minPrice'))}">${opt(0, t('finder.minPrice'), f.pmin)}${ps.slice(0, -1).map(v => opt(v, money(v), f.pmin)).join('')}</select>
      <span aria-hidden="true">–</span>
      <select name="pmax" aria-label="${esc(t('finder.maxPrice'))}">${opt(0, t('finder.maxPrice'), f.pmax)}${ps.slice(1).map(v => opt(v, money(v), f.pmax)).join('')}</select></div></fieldset>
    <fieldset class="fg"><legend>${esc(t('finder.facing'))}</legend><div class="chips">${chip('facing', '', t('finder.any'), f.facing)}${['N', 'E', 'S', 'W'].map(c => chip('facing', c, t('face.' + c), f.facing)).join('')}</div></fieldset>
    <fieldset class="fg"><legend>${esc(tx('finder.status'))}</legend><div class="chips">${chip('status', '', t('finder.any'), f.status)}${['available', 'reserved', 'sold'].map(s => chip('status', s, t('status.' + s), f.status)).join('')}</div></fieldset>
    <fieldset class="fg fg-floors" ${S.view === 'list' ? '' : 'hidden'}><legend>${esc(t('finder.floorRange'))}</legend><div class="sel2">
      <select name="fmin" aria-label="${esc(t('finder.floorRange'))} min">${floors.map(v => opt(v, floorLabel(v), f.fmin)).join('')}</select>
      <span aria-hidden="true">–</span>
      <select name="fmax" aria-label="${esc(t('finder.floorRange'))} max">${floors.map(v => opt(v, floorLabel(v), f.fmax)).join('')}</select></div></fieldset>
    <button type="button" class="btn link sm" id="fltReset">${esc(t('finder.reset'))}</button>`;
  markFilterCount();
}
function markFilterCount() { const n = activeFilters(), b = $('#filtN'); if (b) { b.hidden = !n; b.textContent = n; } }

function bindFilters() {
  const form = $('#filters');
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('change', e => {
    const el = e.target, f = S.flt;
    if (['rooms', 'facing', 'status'].includes(el.name)) f[el.name] = el.value; else if (el.name in f) f[el.name] = +el.value;
    if (f.fmin > f.fmax) [f.fmin, f.fmax] = [f.fmax, f.fmin];
    if (f.pmin && f.pmax && f.pmin > f.pmax) [f.pmin, f.pmax] = [f.pmax, f.pmin];
    if (f.amin && f.amax && f.amin > f.amax) [f.amin, f.amax] = [f.amax, f.amin];
    S.limit = 30; afterFilter(); markFilterCount();
  });
  form.addEventListener('click', e => {
    if (e.target.id !== 'fltReset') return;
    S.flt = fltDefault(); renderFilters(); afterFilter();
  });
  $('#filtBtn').addEventListener('click', () => {
    const open = !form.classList.contains('open'); form.classList.toggle('open', open); $('#filtBtn').setAttribute('aria-expanded', open);
  });
}
function afterFilter() { plan.applyMatches(); renderStack(); renderCount(); if (S.view === 'list') renderList(); }

function renderCount() {
  const all = UNITS.filter(u => u.building === S.b && matches(u, S.view === 'list'));
  $('#fdCount').textContent = t('finder.results', { n: all.length });
}

function renderTabs() {
  $('#bldTabs').innerHTML = B_IDS.map(b => `<button type="button" role="tab" data-b="${b}" aria-selected="${b === S.b}" aria-label="${esc(bldText(b))}" class="${b === S.b ? 'on' : ''}"><span class="tb-b" dir="ltr">${BUILDINGS[b].no}</span><span class="tb-s">${esc(t('finder.building'))}</span></button>`).join('');
  $$('#viewTabs button').forEach(bt => { const on = bt.dataset.view === S.view; bt.classList.toggle('on', on); bt.setAttribute('aria-selected', on); });
}

// One chip per floor of the chosen building, top floor first. A floor without flats (e.g. a commercial ground floor)
// stays selectable: its plan shows what is there.
function renderStack() {
  const st = $('#floorStack'); const keep = st.scrollLeft;
  let h = '';
  for (const f of [...floorsOf(S.b)].reverse()) {
    const us = unitsOn(S.b, f); const av = us.filter(u => statusOf(u) === 'available' && matches(u)).length;
    const on = f === S.f;
    h += `<button type="button" role="option" aria-selected="${on}" class="fl${on ? ' on' : ''}${us.length ? '' : ' none'}" data-f="${f}" style="--o:${f}" title="${esc(floorText(f))} · ${esc(t('finder.avail', { n: av }))}">
      <span class="fl-n" dir="ltr">${esc(floorLabel(f))}</span>
      <span class="fl-c">${us.length ? av : '–'}</span>
      <span class="fl-bar" aria-hidden="true"><i style="width:${us.length ? Math.round(av / us.length * 100) : 0}%"></i></span></button>`;
  }
  st.innerHTML = h;
  st.scrollLeft = keep;   // re-rendering must not reset the phone strip's sideways scroll
}
// Bring the selected floor chip into view inside the sideways strip (phones) — never scrolls the page itself.
function revealChip(f, smooth = true) {
  const st = $('#floorStack'), c = st.querySelector(`[data-f="${f}"]`);
  if (!c || st.scrollWidth <= st.clientWidth + 1) return;
  const sr = st.getBoundingClientRect(), cr = c.getBoundingClientRect(), pad = 12;
  let dx = 0;
  if (cr.left < sr.left + pad) dx = cr.left - sr.left - pad; else if (cr.right > sr.right - pad) dx = cr.right - sr.right + pad;
  if (Math.abs(dx) > 1) st.scrollBy({ left: dx, behavior: smooth && !reduced ? 'smooth' : 'auto' });
}
function markHoverChip(a) {
  $$('#floorStack .fl.is-hover').forEach(x => x.classList.remove('is-hover'));
  if (a && a.building === S.b) $(`#floorStack [data-f="${a.floor}"]`)?.classList.add('is-hover');
}

// Section elevation of the complex: every tower at its real height (floorY / roofY per building), side by side in
// data order; the chosen tower is lit, the chosen floor highlighted. It is the finder's picture when there is no WebGL,
// and every band is a button for (building, floor).
function renderElev() {
  const host = $('#elev'); if (!host) return;
  const GAP = 7, top = Math.max(...B_IDS.map(roofY));
  let x = 0, body = '';
  for (const b of B_IDS) {
    const B = bboxOf(footprintOf(b)), W = Math.max(8, B.x1 - B.x0), roof = roofY(b), n = Math.max(1, Math.floor((W - 1.2) / 3.2)), pitch = W / n;
    let g = '';
    for (const f of floorsOf(b)) {
      const y0 = floorY(b, f), y1 = f === topFloor(b) ? roof : floorY(b, f + 1), on = b === S.b && f === S.f;
      g += `<g class="ev-fl${on ? ' on' : ''}" data-b="${b}" data-f="${f}"><rect x="${r1(x)}" y="${-y1}" width="${r1(W)}" height="${(y1 - y0).toFixed(2)}" class="ev-band"/>`;
      if (!unitsOn(b, f).length) g += `<rect x="${r1(x + 0.8)}" y="${(-y1 + 0.6).toFixed(2)}" width="${r1(W - 1.6)}" height="${(y1 - y0 - 1).toFixed(2)}" class="ev-glaze"/>`;
      else for (let i = 0; i < n; i++) g += `<rect x="${(x + i * pitch + (pitch - 2) / 2).toFixed(2)}" y="${(-y0 - 2.45).toFixed(2)}" width="2" height="2.05" class="ev-win"/>`;
      g += `</g>`;
    }
    body += `<g class="ev-b${b === S.b ? ' cur' : ''}" data-b="${b}">${g}<rect x="${r1(x)}" y="${-roof}" width="${r1(W)}" height="${roof}" class="ev-out"/><text x="${r1(x + W / 2)}" y="7.4" class="ev2-n">${BUILDINGS[b].no}</text></g>`;
    x += W + GAP;
  }
  const Wt = x - GAP;
  host.innerHTML = `<svg viewBox="-5 ${r1(-top - 9)} ${r1(Wt + 10)} ${r1(top + 19)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" direction="ltr">
    <rect x="-5" y="0" width="${r1(Wt + 10)}" height="1.2" class="ev-ground"/><line x1="-5" x2="${r1(Wt + 5)}" y1="0" y2="0" class="ev-gl"/>${body}
    <text x="${dir === 'rtl' ? r1(Wt) : 0}" y="${r1(-top - 3.4)}" class="ev2-t" ${dir === 'rtl' ? 'direction="rtl" text-anchor="start"' : ''}>${esc(bldText(S.b))} · ${esc(floorText(S.f))}</text></svg>`;
}

function setFloor(b, f, { scroll = false, focusPlan = false } = {}) {
  if (!BUILDINGS[b]) b = S.b;
  f = clampFloor(b, f);                                   // e.g. building 3 floor 17 → building 2: floor 6
  S.b = b; S.f = f;
  renderTabs(); renderStack(); renderElev();
  try { plan.show(b, f); } catch (e) { console.warn('[app] plan.show:', e); }
  setPlanNote();
  renderCount();
  if (S.view === 'list') renderList();
  hero?.focusFloor(b, f);
  revealChip(f);
  $('#announce').textContent = `${bldText(b)} · ${floorText(f)}`;
  // only when the finder is actually off screen (e.g. a floor picked on the hero 3D) — never fights the user's scroll
  if (scroll) {
    const r = $('#finder').getBoundingClientRect();
    if (r.top > innerHeight * 0.6 || r.bottom < 80) $('#finder').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
  if (focusPlan) setTimeout(() => $('#plan .pl-unit')?.focus({ preventScroll: true }), 400);
}

// The note line keeps its reserved height (CSS) whether or not it has text, so the legend below never shifts.
// Non-residential premises of the floor are listed by kind; a floor with no flats says so.
function setPlanNote() {
  const kinds = [...new Set(blocksOn(S.b, S.f).map(k => k.kind))];
  const labels = kinds.map(k => (has('plan.block.' + k) ? t('plan.block.' + k) : '')).filter(Boolean);
  const note = [unitsOn(S.b, S.f).length ? '' : t('finder.noUnits'), labels.join(' · ')].filter(Boolean).join(' ');
  const n = $('#planNote'); n.textContent = note || ' '; n.classList.toggle('is-empty', !note); n.hidden = false;
}

function renderLegend() {
  const roomSet = [...new Set(UNITS.map(u => u.rooms))].sort();
  $('#legend').innerHTML = roomSet.map(r => `<span class="lg"><i class="dot r${r}"></i>${esc(roomsText(r))}</span>`).join('') +
    `<span class="lg"><i class="dot res"></i>${esc(t('status.reserved'))}</span><span class="lg"><i class="dot sold"></i>${esc(t('status.sold'))}</span>` +
    `<span class="lg hint">${esc(matchMedia('(pointer: coarse)').matches ? t('finder.planHint') : t('finder.keyboardHint'))}</span>`;
}

function renderList() {
  const rows = UNITS.filter(u => u.building === S.b && matches(u, true));
  const key = { price: u => u.price, floor: u => u.floor * 100 + u.index, area: u => TYPES[u.type].total }[S.sort];
  rows.sort((a, b) => key(a) - key(b) || a.floor - b.floor || a.index - b.index);
  const shown = rows.slice(0, S.limit);
  $('#listWrap').innerHTML = `<div class="ls-head"><label>${esc(t('finder.sort'))} <select id="lsSort">${['price', 'floor', 'area'].map(k => `<option value="${k}" ${k === S.sort ? 'selected' : ''}>${esc(t('finder.sort.' + k))}</option>`).join('')}</select></label></div>` +
    (rows.length ? `<ul class="ls">${shown.map(u => { const T = TYPES[u.type]; const st = statusOf(u); return `<li><button type="button" class="ls-row ${statusClass(st)}" data-id="${u.id}" aria-label="${esc(unitLabelL(u))}">
      <span class="ls-id"><i class="dot r${u.rooms}"></i><b dir="ltr">${esc(unitCode(u))}</b><small>${esc(floorText(u.floor))}</small></span>
      <span class="ls-r">${esc(roomsText(u.rooms))}</span>
      <span class="ls-a" dir="ltr">${esc(fmtArea(T.total))}</span>
      <span class="ls-f">${esc(facingText(u))}</span>
      <span class="ls-p" dir="ltr">${money(u.price)}</span>
      <span class="ls-s">${esc(t('status.' + st))}</span></button></li>`; }).join('')}</ul>` +
      (rows.length > S.limit ? `<button type="button" class="btn ghost wide" id="lsMore">${esc(t('finder.more'))} (${rows.length - S.limit})</button>` : '')
      : `<p class="empty">${esc(t('finder.noResults'))}</p>`);
}

function setView(v) {
  if (v !== 'plan' && v !== 'list') return;
  S.view = v; renderTabs(); $('#planWrap').hidden = v !== 'plan'; $('#listWrap').hidden = v !== 'list';
  const ff = $('.fg-floors'); if (ff) ff.hidden = v !== 'list';
  renderCount(); if (v === 'list') renderList();
}
function bindFinder() {
  $('#bldTabs').addEventListener('click', e => { const b = e.target.closest('[data-b]')?.dataset.b; if (b && b !== S.b) setFloor(b, S.f); });
  $('#floorStack').addEventListener('click', e => { const f = e.target.closest('[data-f]')?.dataset.f; if (f != null && +f !== S.f) setFloor(S.b, +f); });
  // desktop: hovering a floor chip previews that floor's band on the 3D view
  $('#floorStack').addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const f = e.target.closest('[data-f]')?.dataset.f; if (f != null) hero?.previewFloor?.(S.b, +f); });
  $('#floorStack').addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hero?.previewFloor?.(S.b, null); });
  $('#floorStack').addEventListener('keydown', e => {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault();
    const f = clampFloor(S.b, S.f + (e.key === 'ArrowUp' ? 1 : -1)); setFloor(S.b, f);
    $(`#floorStack [data-f="${f}"]`)?.focus();
  });
  $('#elev').addEventListener('click', e => { const g = e.target.closest('[data-f]'); if (g) setFloor(g.dataset.b || S.b, +g.dataset.f); });
  $('#viewTabs').addEventListener('click', e => setView(e.target.closest('[data-view]')?.dataset.view));
  $('#listWrap').addEventListener('click', e => {
    const r = e.target.closest('.ls-row'); if (r) return openUnit(unitById(r.dataset.id));
    if (e.target.closest('#lsMore')) { S.limit += 30; renderList(); }
  });
  $('#listWrap').addEventListener('change', e => { if (e.target.id === 'lsSort') { S.sort = e.target.value; renderList(); } });
}

// ---------------------------------------------------------------- unit sheet
// Room names come from the plans' vocabulary (TYPES[].list[].nk); a name used twice in one flat is numbered.
function roomRows(T) {
  const count = {}, seen = {};
  for (const r of T.list) count[r.nk] = (count[r.nk] || 0) + 1;
  return T.list.map(r => {
    const base = has(r.nk) ? t(r.nk) : has('room.' + r.kind) ? t('room.' + r.kind) : t('room.other');
    const label = count[r.nk] > 1 ? `${base} ${(seen[r.nk] = (seen[r.nk] || 0) + 1)}` : base;
    return `<tr><th scope="row"><i class="rk rk-${esc(r.kind)}"></i>${esc(label)}</th><td dir="ltr">${esc(fmtArea(r.area))}</td></tr>`;
  }).join('');
}
function viewText(u) {
  const parts = (u.facings?.length ? u.facings : [u.facing]).map(c => t('view.' + c));
  if (u.floor >= 0.6 * topFloor(u.building)) parts.push(t('view.high')); else if (u.floor <= 2) parts.push(t('view.low'));
  return parts.join(' ');
}
const dlgU = () => $('#unitDlg');
const discLabel = d => (has('terms.disc.' + d.id) ? t('terms.disc.' + d.id) : pick(d.label));

// Payment calculator: plan chips, discount chips (none / one category — discounts do not stack), then the rows
// price → discount → to pay → first payment → rest → months × monthly payment. No deposit, mortgage or rent blocks.
function calcHTML(u) {
  const T = PROJECT.terms, plans = T.plans, p = plans.find(x => x.id === S.calcPlan) || plans[0];
  const discs = T.discounts || [], d = discs.find(x => x.id === S.calcDisc) || null;
  const r = breakdown(u.price, p, d ? d.percent : 0);
  const row = (k, v, cls = '') => `<div class="cr ${cls}"><span>${k}</span><b dir="ltr">${v}</b></div>`;
  let rows = row(esc(t('calc.price')), money(r.price));
  if (r.discountPct) rows += row(`${esc(t('calc.discount'))} · ${r.discountPct}%`, '−' + money(r.discount), 'minus');
  rows += row(esc(t('calc.net')), money(r.net), 'strong');
  if (p.months) {
    rows += row(`${esc(t('calc.first'))} · ${p.split[0]}%`, money(r.first));
    rows += row(`${esc(t('calc.rest'))} · ${p.split[1]}%`, money(r.rest));
    rows += row(esc(t('calc.monthlyLabel')), esc(t('calc.monthly', { m: r.months, v: money(r.monthly) })), 'soft');
  }
  return `<div class="calc-tabs chips" role="radiogroup" aria-label="${esc(t('calc.plan'))}">${plans.map(x => `<label class="chip"><input type="radio" name="calcPlan" value="${esc(x.id)}" ${x.id === p.id ? 'checked' : ''}><span>${esc(planText(x))}</span></label>`).join('')}</div>
    <p class="calc-desc">${esc(planText(p, 'desc'))}</p>
    ${discs.length ? `<p class="calc-k" id="calcDiscK">${esc(t('calc.discount'))}</p><div class="calc-tabs chips" role="radiogroup" aria-labelledby="calcDiscK">
      <label class="chip"><input type="radio" name="calcDisc" value="" ${d ? '' : 'checked'}><span>${esc(t('calc.none'))}</span></label>
      ${discs.map(x => `<label class="chip"><input type="radio" name="calcDisc" value="${esc(x.id)}" ${d && x.id === d.id ? 'checked' : ''}><span>${esc(discLabel(x))} · ${x.percent}%</span></label>`).join('')}</div>` : ''}
    <div class="calc-rows">${rows}</div>
    <p class="fine">${discs.length > 1 ? esc(t('calc.discountNote')) + ' ' : ''}${esc(t('calc.disclaimer'))}</p>`;
}

const ACT_ICON = {
  walk: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  tour: '<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3v18M16.5 7.5l2 1.5-2 1.5"/>',
  balcony: '<path d="M3 20h18M5 20v-7h14v7M9 13v7M15 13v7M12 13v7M4 9l8-5 8 5"/>',
  lobby: '<path d="M4 21V5l8-3 8 3v16M4 21h16M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2"/>',
};
const SWATCH = { milano: ['#3b2a1f', '#121212', '#b08a4e', '#3a3a3f'], nordic: ['#d9c6a4', '#f3f1ec', '#d8d2c4', '#1c1c1c'], riviera: ['#d8c4a6', '#e9dcc6', '#7c8455', '#b5654a'], monaco: ['#121212', '#cfa75e', '#1f4a3a', '#1c2947'], kyoto: ['#e6dccb', '#d4bf9c', '#efe6d4', '#3e322a'], paris: ['#f4f1ea', '#c9a877', '#9db3c6', '#dbb4ae'] };

function renderUnit() {
  const u = S.unit; if (!u) return;
  const T = TYPES[u.type]; const st = statusOf(u), b = u.building, walkOk = canWalk(u);
  const act = (a, key) => `<button type="button" class="act" data-act="${a}"><svg viewBox="0 0 24 24" aria-hidden="true">${ACT_ICON[a]}</svg><span>${esc(t(key))}</span></button>`;
  const acts = [walkOk ? act('walk', 'unit.walk') : '', F.photoTour ? photoBtnHTML(u) : '', walkOk ? act('tour', 'unit.tour') : '',
    walkOk && T.outdoorKind ? act('balcony', 'unit.balcony') : '', F.walk ? act('lobby', 'unit.lobby') : ''].join('');
  const srcNote = u.priceSource === 'rooms' ? t('unit.priceEst') : tx('unit.priceSrc.' + (u.priceSource === 'list' ? 'list' : 'table'));
  const planSvg = svgFrom('unitPlanSVG', u), keySvg = svgFrom('keyPlanSVG', u), delivery = deliveryText(b);
  const fact = (k, v, ltr) => (v ? `<div><dt>${esc(t(k))}</dt><dd${ltr ? ' dir="ltr"' : ''}>${esc(v)}</dd></div>` : '');
  const msg = st === 'reserved' ? t('unit.reservedMsg') : st === 'sold' ? t('unit.soldMsg') : '';
  dlgU().innerHTML = `<div class="sheet-card">
    <header class="sh-head">
      <div><p class="eyebrow">${esc(unitLabelL(u))}</p>
      <h2 id="ud-title" class="h3">${esc(roomsText(u.rooms))} · <span dir="ltr">${esc(fmtArea(T.total))}</span></h2>
      ${PROJECT.numbering === 'provisional' ? `<p class="sh-num">${esc(t('unit.numNote'))}</p>` : ''}</div>
      <button type="button" class="icon-btn" data-act="close" aria-label="${esc(t('unit.close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6"/></svg></button>
    </header>
    <div class="sh-body">
      <div class="sh-price">
        <div><p class="k">${esc(t('unit.price'))}</p><p class="price" dir="ltr">${money(u.price)}</p><p class="ppm"><b dir="ltr">${money(u.ppm)}</b> ${esc(t('unit.perM2'))}</p><p class="ppm-note">${esc(t('unit.perM2Note', { p: money(u.ppm) }))}</p></div>
        <span class="pill ${statusClass(st)}">${esc(t('status.' + st))}</span>
      </div>
      <p class="est">${esc(srcNote)}</p>
      ${planSvg ? `<section class="sh-plan"><h3 class="h5">${esc(t('unit.plan'))}</h3><div class="unitplan-wrap">${planSvg}</div></section>` : ''}
      <div class="sh-key${keySvg ? '' : ' solo'}">${keySvg}
        <dl class="sh-facts">
          ${fact('unit.total', fmtArea(T.total), true)}${fact('unit.living', T.living ? fmtArea(T.living) : '', true)}
          ${fact('unit.facing', facingText(u))}${fact('finder.floor', t('unit.floorOf', { n: floorLabel(u.floor), m: topFloor(b) }), true)}
          ${fact('unit.delivery', delivery)}
        </dl>
      </div>
      <div class="sh-acts">${acts}</div>
      ${F.walk && !u.walk ? `<p class="notice-in">${esc(t('unit.noWalk'))}</p>` : ''}
      ${msg ? `<p class="notice-in">${esc(msg)}</p>` : ''}
      <section class="sh-sec"><h3 class="h5">${esc(t('unit.areas'))}</h3>
        <table class="areas"><tbody>${roomRows(T)}</tbody><tfoot>
          <tr><th scope="row">${esc(t('unit.util'))}</th><td dir="ltr">${esc(fmtArea(T.util))}</td></tr>
          ${T.outdoor > 0 ? `<tr><th scope="row">${esc(t('unit.outdoor'))}</th><td dir="ltr">${esc(fmtArea(T.outdoor))}</td></tr>` : ''}
          <tr class="strong"><th scope="row">${esc(t('unit.total'))}</th><td dir="ltr">${esc(fmtArea(T.total))}</td></tr>
          ${T.built != null ? `<tr><th scope="row">${esc(t('unit.built'))}</th><td dir="ltr">${esc(fmtArea(T.built))}</td></tr>` : ''}</tfoot></table>
        ${T.est || u.est ? `<p class="est">${esc(t('unit.est'))}</p>` : ''}
      </section>
      <section class="sh-sec"><h3 class="h5">${esc(t('unit.view'))}</h3><p class="muted">${esc(viewText(u))}</p></section>
      ${walkOk ? `<section class="sh-sec"><h3 class="h5">${esc(t('unit.design'))}</h3>
        <div class="styles" role="radiogroup" aria-label="${esc(t('unit.design'))}">${STYLES.map(id => `<label class="style-card"><input type="radio" name="style" value="${id}" ${id === S.styleId ? 'checked' : ''}>
          <span class="sw" aria-hidden="true">${SWATCH[id].map(c => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="st-n">${esc(t('style.' + id + '.n'))}</span><span class="st-d">${esc(t('style.' + id + '.d'))}</span></label>`).join('')}</div>
        <p class="fine">${esc(t('unit.designNote'))}</p></section>` : ''}
      <section class="sh-sec ug" id="unitGal" hidden></section>
      <section class="sh-sec calc" id="calc"><h3 class="h5">${esc(t('calc.title'))}</h3><div id="calcBody">${calcHTML(u)}</div></section>
      <button type="button" class="btn link sm" data-act="share"><span class="copy-l">${esc(t('unit.share'))}</span></button>
      <p class="fine">${esc(t('facts.disclaimer'))}</p>
    </div>
    <footer class="sh-foot"><div class="sh-foot-p"><b dir="ltr">${money(u.price)}</b><span dir="ltr">${esc(fmtArea(T.total))}</span></div>
      <button type="button" class="btn primary" data-act="reserve" ${st !== 'available' ? 'disabled' : ''}>${esc(t('unit.reserve'))}</button></footer>
  </div>`;
  renderUnitGallery();
}

function openUnit(u) {
  if (!u) return;
  S.unit = u; plan?.select(u.id); hero?.highlightUnits([u.id]);
  renderUnit();
  const d = dlgU();
  if (!d.open) { S.unitReturn = document.activeElement; d.showModal(); document.documentElement.classList.add('modal-open'); }
  d.querySelector('.sh-body').scrollTop = 0;
  try { history.replaceState(null, '', '#u=' + u.id); } catch (e) { /* sandboxed */ }
  setTimeout(() => d.querySelector('[data-act="close"]')?.focus(), 20);
  if (canWalk(u)) { preloadStill(stillFor(u, 'apartment')); prewarmWalkFor(u); }
  if (phoneSheet()) hero?.pause();   // the sheet covers the whole screen on phones: free the CPU/GPU for the pre-warm
}
const phoneSheet = () => matchMedia('(max-width: 899px)').matches;
const u0 = () => S.unit;
function closeUnit() {
  const d = dlgU(); if (!d.open) return;
  d.classList.add('is-closing');
  setTimeout(() => { d.classList.remove('is-closing'); d.close(); document.documentElement.classList.remove('modal-open'); S.unitReturn?.focus?.({ preventScroll: true }); }, 200);
  hero?.highlightUnits(null);
  if ($('#walk').hidden) resumeHero();
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sandboxed */ }
}
function bindUnit() {
  const d = dlgU();
  d.addEventListener('cancel', e => { e.preventDefault(); closeUnit(); });
  d.addEventListener('click', async e => {
    if (e.target === d) return closeUnit();
    const a = e.target.closest('[data-act]')?.dataset.act; const u = S.unit;
    if (!u || (!a && !e.target.closest('[data-ui]'))) return;
    const ug = e.target.closest('[data-ui]'); if (ug) return lbOpen($('#unitGal')._list || [], +ug.dataset.ui);
    if (a === 'close') closeUnit();
    else if (a === 'walk') openWalk(u.id, 'apartment', 'walk');
    else if (a === 'photo') openPhoto({ unitId: u.id, styleId: S.styleId, room: 'living' });
    else if (a === 'photo-soon') openWalk(u.id, 'apartment', 'walk');
    else if (a === 'tour') openWalk(u.id, 'apartment', '360');
    else if (a === 'balcony') openWalk(u.id, 'balcony', '360');
    else if (a === 'lobby') openWalk(u.id, 'lobby', 'walk');
    else if (a === 'reserve') reserve(u);
    else if (a === 'share') {
      const btn = e.target.closest('[data-act]'); const url = location.href.split('#')[0] + '#u=' + u.id;
      const ok = await copyText(url);
      const l = btn.querySelector('.copy-l'); const old = l.textContent; l.textContent = ok ? t('unit.copied') : url; setTimeout(() => (l.textContent = old), 1800);
    }
  });
  d.addEventListener('change', e => {
    if (e.target.name === 'style') { S.styleId = e.target.value; lsSet('vrc.style', S.styleId); renderUnitGallery(); if (canWalk(u0())) { preloadStill(stillFor(u0(), 'apartment')); prewarmWalkFor(u0()); } }
    if (e.target.name === 'calcPlan' || e.target.name === 'calcDisc') {
      const name = e.target.name; S[name] = e.target.value;
      $('#calcBody').innerHTML = calcHTML(S.unit); $$(`#calcBody input[name="${name}"]`).find(i => i.value === S[name])?.focus();
    }
  });
}

function reserve(u) {
  if (!u || statusOf(u) !== 'available') return;
  if (!BK?.openBooking) {                       // booking module unavailable: the contacts in the footer are the fallback
    closeUnit(); $('#contact')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); return;
  }
  BK.openBooking({
    unit: u, planId: S.calcPlan, discount: S.calcDisc,
    onReserved: id => { reserved.add(id); plan.refresh(); renderStack(); if (S.unit?.id === id) renderUnit(); if (S.view === 'list') renderList(); },
  });
}

// ---------------------------------------------------------------- walkthrough: instant open + idle pre-warm
// Opening shows a still (a render from the gallery manifest, when there is one) at once while the live 3D builds
// behind it; walk.js then streams apartment → corridor → surroundings. In idle time the page pre-warms: module
// preload, textures (worker + IndexedDB), and for the open unit sheet the apartment and its shaders (prewarmWalk).
const WALK_MODS = ['js/three/walk.js', 'js/three/materials.js', 'js/three/apartment.js', 'js/three/furniture.js', 'js/three/commons.js',
  'js/three/commons-floor.js', 'js/three/commons-parking.js', 'js/three/cars.js', 'js/three/environment.js', 'js/three/site-layout.js',
  'js/three/context.js', 'js/three/exterior.js', 'js/three/exterior-tower.js', 'js/three/exterior-podium.js',
  'vendor/addons/environments/RoomEnvironment.js', 'vendor/addons/utils/BufferGeometryUtils.js', 'vendor/addons/geometries/RoundedBoxGeometry.js'];
let walkModP = null;
const walkModule = () => (walkModP ||= import('./three/walk.js').catch(e => { walkModP = null; throw e; }));
const lowData = () => { try { const c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))); } catch (e) { return false; } };
const onIdle = (fn, timeout = 2500) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 300));
function preloadWalkModules() {
  if (!F.walk || preloadWalkModules.done || lowData()) return; preloadWalkModules.done = true;
  for (const href of WALK_MODS) {
    if (document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) continue;
    const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = href; document.head.appendChild(l);
  }
}
let warmT = 0;
function prewarmWalkFor(u, delay = 600) {
  if (!F.walk || lowData() || (u && !u.walk)) return;
  clearTimeout(warmT);
  warmT = setTimeout(() => onIdle(() => {
    if (!$('#walk').hidden) return;
    preloadWalkModules();
    walkModule().then(m => m.prewarmWalk && m.prewarmWalk({ unitId: u ? u.id : null, styleId: S.styleId, shaders: !!u })).catch(() => {});
  }), delay);
}
// Still for the place the walkthrough opens in. Only images the gallery manifest lists are ever used: a render of the
// wanted room (same design, and the same layout when the manifest names one), else an exterior render, else none.
function stillFor(u, start, room) {
  if (!G.items.length) return null;
  const kind = ['lobby', 'corridor', 'parking'].includes(start) ? start : start === 'balcony' ? 'balcony' : (room && room.kind) || 'living';
  const want = { living: 'living', kitchen: 'kitchen', bedroom: 'bedroom', bath: 'bath', hall: 'living', dressing: 'bedroom', storage: 'living', balcony: 'balcony', loggia: 'balcony', terrace: 'balcony' }[kind] || kind;
  const name = it => (it.src || '').split('/').pop().replace(/\.\w+$/, '');
  const sid = STILL_STYLE[S.styleId] || S.styleId;
  let best = null, bs = -1;
  for (const it of G.items) {
    const n = name(it);
    if (it.type === 'exterior' || !n.includes(want) || (it.style && it.style !== sid)) continue;
    if (it.unitType && !(u && it.unitType === u.type)) continue;        // a render of another layout is never shown for this flat
    const s = (it.unitType ? 3 : 0) + (n === `${sid}-${want}` || n === want ? 1 : 0);
    if (s > bs) { bs = s; best = it; }
  }
  if (best) return best.url;
  const ext = G.items.filter(it => it.type === 'exterior');
  return (ext.find(it => name(it) === 'aerial-southeast') || ext[0])?.url ?? null;
}
const stillCache = new Map();
function preloadStill(url) {
  if (!url || stillCache.has(url)) return;
  const im = new Image(); im.decoding = 'async'; im.src = url; stillCache.set(url, im);
  im.decode?.().catch(() => {});
}
function veilStyles() {
  if (document.getElementById('walkStillCss')) return;
  const st = document.createElement('style'); st.id = 'walkStillCss';
  st.textContent = `.walk-still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.04);transition:opacity .35s ease;pointer-events:none}
.walk-still.on{opacity:1;animation:walkStillZoom 14s ease-out forwards}
@keyframes walkStillZoom{from{transform:scale(1.04)}to{transform:scale(1.12)}}
.walk-veil.has-still{place-items:end center;background:#050403}
.walk-veil.has-still::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,4,3,.35) 0%,rgba(5,4,3,0) 30%,rgba(5,4,3,0) 55%,rgba(5,4,3,.82) 100%);pointer-events:none}
.walk-veil.has-still .walk-load{position:relative;z-index:1;gap:6px;padding:0 24px calc(28px + env(safe-area-inset-bottom))}
.walk-veil.has-still .walk-bird{width:40px}
.walk-veil.has-still .walk-t{font-size:20px;margin-top:4px}
.walk-veil.has-still .walk-s{font-size:13px;color:rgba(243,234,215,.8)}
.walk-veil.is-out{opacity:0;transition:opacity .35s ease;pointer-events:none}
@media (prefers-reduced-motion:reduce){.walk-still.on{animation:none}}`;
  document.head.appendChild(st);
}
function showStill(unitId, start, room) {
  veilStyles();
  const V = $('#walkVeil'); V.classList.remove('is-out');
  let img = V.querySelector('.walk-still');
  if (!img) { img = document.createElement('img'); img.className = 'walk-still'; img.alt = ''; img.decoding = 'async'; V.prepend(img); }
  const url = stillFor(unitById(unitId), start, room);
  img.classList.remove('on'); V.classList.remove('has-still');
  if (!url) return;
  const on = () => { if (!V.hidden && img.dataset.src === url) { img.classList.add('on'); V.classList.add('has-still'); } };
  img.dataset.src = url;
  img.onerror = () => { img.classList.remove('on'); V.classList.remove('has-still'); };
  if (img.getAttribute('src') !== url) img.src = url;
  if (img.complete && img.naturalWidth) on(); else img.onload = on;
}
function hideVeil() {
  const V = $('#walkVeil');
  if (V.hidden) return;
  V.classList.add('is-out');
  setTimeout(() => { if (V.classList.contains('is-out')) { V.hidden = true; V.classList.remove('is-out', 'has-still'); V.querySelector('.walk-still')?.classList.remove('on'); } }, 360);
}

// ---------------------------------------------------------------- walkthrough overlay
let walk = null; let walkArgs = null; let walkFromUnit = false;
async function openWalk(unitId, start, mode, room, from) {
  if (!F.walk) return;                                   // PROJECT.features.walk = false: no walkthrough at all
  closePhoto(true);
  walkArgs = { unitId, start, mode };
  const W = $('#walk'); W.hidden = false; W.classList.remove('is-ready'); document.documentElement.classList.add('walk-open');
  // A modal <dialog> sits in the top layer above any z-index, so step out of the unit sheet while walking
  if (dlgU().open) { walkFromUnit = true; dlgU().close(); }
  $('#walkVeil').hidden = false; $('#walkVeil').classList.remove('failed');
  showStill(unitId, start, room);
  $('#walkT').textContent = t('walk.loading'); $('#walkS').textContent = t('walk.loadingSub'); $('#walkRetry').hidden = true;
  $('#walkX').focus();
  hero?.pause();
  clearTimeout(warmT);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));   // the still is on screen before the 3D work starts
  if (W.hidden) return;
  try {
    const mod = await walkModule();
    if (W.hidden) return;
    if (walk) { try { walk.dispose(); } catch (e) {} walk = null; }
    walk = new mod.Walkthrough($('#walkStage'), {
      i18n: i18nApi, styleId: S.styleId, timeMode: S.timeMode,
      onExit: () => closeWalk(),
      onReserve: id => { closeWalk(); const u = unitById(id || unitId); if (u) { openUnit(u); reserve(u); } },
    });
    const placed = !!(from && mod.Walkthrough.startsFromPano && from.frame !== 'building' && isFinite(from.u));
    if (/[?&]debug3d\b/.test(location.search)) window.__vrcWalk = walk;   // test hook (tools/test-site.py)
    await walk.enter({ unitId, start, mode, from: placed ? from : null });
    if (!placed && room && start === 'apartment' && room.kind && room.kind !== 'living' && walk.jumpToRoom) await walk.jumpToRoom(room.kind, room.index | 0);
    hideVeil(); W.classList.add('is-ready'); // the HUD has its own Exit button
  } catch (e) {
    console.warn('[walk] unavailable:', e);
    $('#walkVeil').classList.add('failed'); $('#walkVeil').classList.remove('has-still', 'is-out'); $('#walkVeil .walk-still')?.classList.remove('on');
    $('#walkT').textContent = t('walk.unavailable'); $('#walkS').textContent = '';
    const r = $('#walkRetry'); r.hidden = false; r.textContent = t('walk.retry');
  }
}
function closeWalk() {
  const W = $('#walk'); closePhoto(true); if (W.hidden) return;
  try { walk?.dispose(); } catch (e) { /* ignore */ }
  walk = null; $('#walkStage').innerHTML = ''; W.hidden = true;
  document.documentElement.classList.remove('walk-open');
  if (walkFromUnit && S.unit) { walkFromUnit = false; renderUnit(); dlgU().showModal(); }
  if (!(dlgU().open && phoneSheet())) resumeHero();
  (dlgU().open ? dlgU().querySelector('[data-act="walk"],[data-act="lobby"],[data-act="close"]') : $('#heroTour'))?.focus?.();
  if (dlgU().open && S.unit) prewarmWalkFor(S.unit, 2500);   // the spare renderer went with the walkthrough
}
// Building tour (hero button): starts in the ground-floor lobby; the target flat is a walkable flat of the default
// building and floor (an available one when there is a choice). No such flat or no walkthrough → no button.
function tourUnit() {
  if (!F.walk) return null;
  const pool = UNITS.filter(u => u.walk && u.building === DEFAULT_SEL.b && u.floor === DEFAULT_SEL.f);
  return pool.find(u => statusOf(u) === 'available') || pool[0] || UNITS.find(u => u.walk) || null;
}
function bindWalk() {
  $('#walkX').addEventListener('click', closeWalk);
  $('#walkRetry').addEventListener('click', () => walkArgs && openWalk(walkArgs.unitId, walkArgs.start, walkArgs.mode));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#walk').hidden && !$('#walkVeil').hidden) closeWalk(); });
  const tour = $('#heroTour'); if (!tour) return;
  tour.hidden = !tourUnit();
  tour.addEventListener('click', () => { const u = tourUnit(); if (u) openWalk(u.id, 'lobby', 'walk'); });
}

// ---------------------------------------------------------------- photoreal 360° tour (js/pano-tour.js, lazy)
// Only when PROJECT.features.photoTour: pre-rendered panoramas per layout × design (assets/tour/tour.json), shown in
// the #walk overlay on their own or on top of a running Walkthrough (walk.js calls window.VRC.openPhotoTour).
// With the feature off nothing is fetched, the button is not rendered and the hooks answer "no".
let TOUR = { types: {} }; let photo = null; let tourT = () => '';
const tourReady = !F.photoTour ? Promise.resolve(TOUR) : Promise.all([
  fetch('assets/tour/tour.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
  import('./i18n-tour.js').then(m => { if (m.tt) tourT = m.tt; }).catch(() => {}),
]).then(([m]) => { TOUR = m && m.types ? m : { types: {} }; refreshPhotoBtn(); return TOUR; });
const hasPhoto = u => !!(F.photoTour && u && TOUR.types[u.type] && Object.keys(TOUR.types[u.type].styles || {}).length);
const PHOTO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>';
function photoBtnHTML(u) {
  if (!hasPhoto(u)) return '';
  return `<button type="button" class="act" data-act="photo">${PHOTO_ICON}<span>${esc(tourT(lang, 'btn'))}</span></button>`;
}
function refreshPhotoBtn() { if (F.photoTour && S.unit && dlgU()?.open) renderUnit(); }
const roomRef = r => (r && typeof r === 'object' ? { kind: r.kind || 'living', index: r.index | 0 } : { kind: r || 'living', index: 0 });
async function openPhoto({ unitId, styleId, room, onBack } = {}) {
  const W = $('#walk'); const overWalk = !!(walk && !W.hidden);
  closePhoto(true);
  if (!overWalk) {
    walkArgs = { unitId, start: 'apartment', mode: 'walk' };
    W.hidden = false; W.classList.remove('is-ready'); document.documentElement.classList.add('walk-open');
    if (dlgU().open) { walkFromUnit = true; dlgU().close(); }
    $('#walkVeil').hidden = false; $('#walkVeil').classList.remove('failed'); $('#walkRetry').hidden = true;
    showStill(unitId, 'apartment', roomRef(room));
    $('#walkT').textContent = tourT(lang, 'loading'); $('#walkS').textContent = '';
    hero?.pause();
  }
  const layer = document.createElement('div');
  layer.className = 'tour-layer'; layer.style.cssText = 'position:absolute;inset:0;z-index:30;background:#050505';
  W.appendChild(layer);
  const P = photo = { layer, handle: null, overWalk };
  const toLive = st => {
    const r = roomRef(st && st.room ? st.room : room);
    closePhoto(true);
    if (overWalk && walk) { if (onBack) onBack(r.kind, r.index); else walk.jumpToRoom?.(r.kind, r.index); return; }
    openWalk(unitId, r.kind === 'balcony' ? 'balcony' : ['lobby', 'corridor', 'parking'].includes(r.kind) ? r.kind : 'apartment', 'walk', r, st && st.unitId === unitId ? st : null);
  };
  try {
    const mod = await import('./pano-tour.js');
    if (photo !== P) return;
    P.handle = await mod.openPanoTour(layer, {
      unitId, styleId: styleId || S.styleId, room: roomRef(room), i18n: i18nApi, lang, dir,
      onExit: () => { closePhoto(true); closeWalk(); },
      onReserve: id => { closePhoto(true); closeWalk(); const u = unitById(id || unitId); if (u) { openUnit(u); reserve(u); } },
      onSwitchTo3D: toLive,
    });
    if (photo !== P) { P.handle?.dispose?.(); return; }
    hideVeil(); W.classList.add('is-ready');
  } catch (e) {
    console.warn('[photo] unavailable:', e);
    toLive(null);
  }
}
function closePhoto(silent) {
  const P = photo; if (!P) return; photo = null;
  try { P.handle?.dispose?.(); } catch (e) { /* ignore */ }
  P.layer.remove();
}
window.VRC = window.VRC || {};
// walk.js hook: ({unitId, styleId, room:{kind,index}, onBack(kind,index)}) → Promise
window.VRC.openPhotoTour = (o = {}) => (F.photoTour ? openPhoto({ unitId: o.unitId, styleId: o.styleId, room: o.room || o.roomKind, onBack: o.onBack }) : Promise.resolve());
window.VRC.hasPhotoTour = unitId => hasPhoto(unitById(unitId));
window.VRC.photoTourReady = tourReady;
window.VRC.openBooking = id => { const u = unitById(id); if (u) reserve(u); else document.querySelector('.site-foot')?.scrollIntoView({ behavior: 'smooth' }); };
// progress.js hook (CONTRACT §6): photos [{url, caption, credit?}] in the page's lightbox
window.VRC.openLightbox = (list, i = 0) => {
  const items = (Array.isArray(list) ? list : []).filter(p => p && p.url).map(p => ({ url: p.url, caption: p.caption, credit: p.credit, type: 'exterior', plain: true }));
  if (items.length) lbOpen(items, Math.max(0, Math.min(items.length - 1, i | 0)));
};

// ---------------------------------------------------------------- gallery (assets/gallery/manifest.json)
// The manifest is the only source: [{src, type: exterior | interior | lobby | amenity, caption: {uk, en, …}, style?, unitType?}].
// An image that fails to load is removed; with no usable entry the section and its nav links stay hidden.
const GAL_TYPES = ['exterior', 'interior', 'lobby', 'amenity'];
const G = { items: [], tab: 'all', lb: { list: [], i: 0 } };
const capOf = it => (it.caption ? (typeof it.caption === 'string' ? it.caption : (it.caption[lang] ?? it.caption.uk ?? it.caption.en ?? Object.values(it.caption)[0] ?? '')) : '');
const safeSrc = s => typeof s === 'string' && s && !/^[a-z][\w+.-]*:|^\/\//i.test(s) && !s.includes('..'); // local, relative only

async function loadGallery() {
  let url = 'assets/gallery/manifest.json';
  try { const q = new URLSearchParams(location.search).get('gallery'); if (q && safeSrc(q)) url = q; } catch (e) { /* ignore */ }
  let list = [];
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (r.ok) list = await r.json();
  } catch (e) { list = []; }
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  G.items = (Array.isArray(list) ? list : []).filter(it => it && safeSrc(it.src) && GAL_TYPES.includes(it.type))
    .map(it => ({ ...it, url: it.src.startsWith('assets/') ? it.src : base + it.src.replace(/^\.\//, '') }));
  renderGallery();
  if (dlgU().open) { renderUnitGallery(); if (canWalk(S.unit)) preloadStill(stillFor(S.unit, 'apartment')); }
}

function galList() { return G.tab === 'all' ? G.items : G.items.filter(i => i.type === G.tab); }
function dropGalItem(url) { G.items = G.items.filter(it => it.url !== url); if (!G.items.length) renderGallery(); }
function renderGallery() {
  const has = G.items.length > 0;
  $('#gallery').hidden = !has; $$('.nav-gal').forEach(a => { a.hidden = !has; });
  if (!has) return;
  const types = GAL_TYPES.filter(ty => G.items.some(i => i.type === ty));
  if (!types.includes(G.tab)) G.tab = 'all';
  $('#galTabs').innerHTML = types.length > 1 ? ['all', ...types].map(ty => `<button type="button" role="tab" data-gt="${ty}" aria-selected="${ty === G.tab}" class="${ty === G.tab ? 'on' : ''}">${esc(t('gal.' + ty))}</button>`).join('') : '';
  const list = galList();
  $('#galGrid').innerHTML = list.map((it, i) => `<button type="button" class="gal-item${i === 0 ? ' feat' : ''}" data-gu="${esc(it.url)}" aria-label="${esc(t('gal.open'))}: ${esc(capOf(it) || t('gal.' + it.type))}">
      <img src="${esc(it.url)}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async">
      <span class="gal-cap"><span class="gal-k">${esc(t('gal.' + it.type))}${it.style ? ' · ' + esc(t('style.' + it.style + '.n')) : ''}</span>${capOf(it) ? `<span class="gal-t">${esc(capOf(it))}</span>` : ''}</span></button>`).join('');
  $$('#galGrid img').forEach(img => img.addEventListener('error', () => { const b = img.closest('.gal-item'); if (b) { dropGalItem(b.dataset.gu); b.remove(); } }, { once: true }));
}

// Images for the open unit: interior renders only (the chosen design first). No interiors in the manifest → no strip.
function unitGalleryList(u) {
  const sid = STILL_STYLE[S.styleId] || S.styleId;
  const score = it => (it.unitType && it.unitType === u.type ? 3 : 0) + (it.style === S.styleId ? 2 : it.style === sid ? 1 : 0);
  return G.items.filter(it => it.type === 'interior' && (!it.unitType || it.unitType === u.type))
    .sort((a, b) => score(b) - score(a)).slice(0, 10);
}
function renderUnitGallery() {
  const host = dlgU().querySelector('#unitGal'); if (!host || !S.unit) return;
  const list = unitGalleryList(S.unit);
  host.hidden = !list.length;
  host.innerHTML = list.length ? `<h3 class="h5">${esc(t('unit.gallery'))}</h3><div class="ug-strip">${list.map((it, i) => `<button type="button" class="ug-item" data-ui="${i}" aria-label="${esc(t('gal.open'))}: ${esc(capOf(it) || t('gal.' + it.type))}"><img src="${esc(it.url)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>` : '';
  host._list = list;
  host.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.closest('.ug-item')?.remove(), { once: true }));
}

// ---- lightbox (keyboard ←/→, swipe on touch, focus returns to the opener)
function lbShow(i) {
  const L = G.lb.list; if (!L.length) return;
  G.lb.i = (i + L.length) % L.length; const it = L[G.lb.i];
  const kind = it.plain ? '' : t('gal.' + it.type);
  const img = $('#lbImg'); img.classList.remove('in'); img.src = it.url; img.alt = capOf(it) || kind;
  img.decode?.().catch(() => {}).finally(() => requestAnimationFrame(() => img.classList.add('in')));
  $('#lbCap').textContent = [kind, it.style ? t('style.' + it.style + '.n') : '', capOf(it), it.credit || ''].filter(Boolean).join(' · ');
  $('#lbN').textContent = `${G.lb.i + 1} / ${L.length}`;
  const multi = L.length > 1; $('#lightbox .lb-prev').hidden = !multi; $('#lightbox .lb-next').hidden = !multi;
}
function lbOpen(list, i) {
  G.lb.list = list; G.lb.ret = document.activeElement;
  const d = $('#lightbox'); if (!d.open) d.showModal(); document.documentElement.classList.add('modal-open');
  lbShow(i); d.querySelector('.lb-x').focus();
}
function lbClose() {
  const d = $('#lightbox'); if (!d.open) return; d.close();
  if (!dlgU().open) document.documentElement.classList.remove('modal-open');
  G.lb.ret?.focus?.({ preventScroll: true });
}
function bindGallery() {
  $('#galTabs').addEventListener('click', e => { const ty = e.target.closest('[data-gt]')?.dataset.gt; if (ty) { G.tab = ty; renderGallery(); $(`#galTabs [data-gt="${ty}"]`)?.focus(); } });
  $('#galGrid').addEventListener('click', e => { const b = e.target.closest('[data-gu]'); if (!b) return; const L = galList(), i = L.findIndex(it => it.url === b.dataset.gu); if (i >= 0) lbOpen(L, i); });
  const d = $('#lightbox');
  const rtlStep = k => (dir === 'rtl' ? -k : k);
  d.addEventListener('cancel', e => { e.preventDefault(); lbClose(); });
  d.addEventListener('click', e => {
    const a = e.target.closest('[data-lb]')?.dataset.lb;
    if (a === 'close') lbClose(); else if (a === 'prev') lbShow(G.lb.i - 1); else if (a === 'next') lbShow(G.lb.i + 1);
    else if (e.target === d || e.target.id === 'lbStage') lbClose();
  });
  d.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbShow(G.lb.i + rtlStep(-1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbShow(G.lb.i + rtlStep(1)); }
  });
  let sw = null; const stage = $('#lbStage');
  stage.addEventListener('pointerdown', e => { sw = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  stage.addEventListener('pointerup', e => {
    if (!sw || sw.id !== e.pointerId) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { lbShow(G.lb.i + (dx < 0 ? rtlStep(1) : rtlStep(-1))); }
  });
  stage.addEventListener('pointercancel', () => { sw = null; });
}

// ---------------------------------------------------------------- hero 3D (lazy)
let hero = null;
let heroDeferred = false;
function startHero() {
  if (hero) return;
  if (!H3?.createHero3D) {                                                    // feature off, no WebGL or module missing: static slides + elevation
    document.body.classList.add('no-3d');
    window.__vrcHero3D = 'failed'; document.dispatchEvent(new CustomEvent('vrc:hero3d-state', { detail: 'failed' }));   // hero-slides.js drops its 3D slide
    return;
  }
  let save = false; try { save = !!navigator.connection?.saveData; } catch (e) {}
  if (save) return;
  try {
    hero = H3.createHero3D({
      heroHost: $('#heroHost'), finderHost: $('#finderHost'), reducedMotion: reduced,
      // a floor tapped on the finder's own 3D view must not move the page; one picked on the hero scrolls to the finder
      onFloor: (b, f, where) => { if (b !== S.b || f !== S.f) setFloor(b, f, { scroll: where === 'hero' }); else if (where === 'hero') setFloor(b, f, { scroll: true }); },
      onState: (s, a) => {
        if (s === 'hover') { markHoverChip(a); return; }
        if (s === 'ready') {
          document.body.classList.add('has-3d');
          $('#modeCtl').hidden = false; $('#heroHint').hidden = false; markMode('dusk');
          hero?.focusFloor(S.b, S.f);
        } else if (s === 'failed') { document.body.classList.add('no-3d'); hero = null; }
      },
    });
  } catch (e) { console.warn('[app] hero 3D:', e); hero = null; document.body.classList.add('no-3d'); return; }
  if (!hero) return;
  // Under a full-screen unit sheet (phones) or the walkthrough the hero is invisible: building it now would only
  // compete with the walkthrough's pre-warm. It is created (the slideshow keeps its 3D slide) but built once the
  // page is visible again (closeUnit / closeWalk → resumeHero).
  if ((dlgU().open && phoneSheet()) || !$('#walk').hidden) { heroDeferred = true; return; }
  initHero();
}
const initHero = () => { try { Promise.resolve(hero?.init()).catch(e => console.warn('[app] hero 3D init:', e)); } catch (e) { console.warn('[app] hero 3D init:', e); } };
const resumeHero = () => {
  if (!hero) return;
  hero.resume();
  if (heroDeferred) { heroDeferred = false; onIdle(initHero, 1500); }
};
function markMode(m) { S.timeMode = m; $$('#modeCtl button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m)); }

// ---------------------------------------------------------------- header / nav / language
function bindHeader() {
  const head = $('#head');
  const onScroll = () => head.classList.toggle('scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const nav = $('#nav'), mb = $('#menuBtn');
  mb.addEventListener('click', () => { const o = !nav.classList.contains('open'); nav.classList.toggle('open', o); mb.setAttribute('aria-expanded', o); head.classList.toggle('menu-open', o); });
  nav.addEventListener('click', e => { if (e.target.closest('a')) { nav.classList.remove('open'); mb.setAttribute('aria-expanded', false); head.classList.remove('menu-open'); } });
  bindLangMenu();
  $('#modeCtl').addEventListener('click', e => { const m = e.target.closest('[data-mode]')?.dataset.mode; if (m) { hero?.setMode(m); markMode(m); } });
}
// Language dropdown: flag + native name, keyboard navigable (listbox pattern)
function markLang() {
  const L = langInfo(lang);
  $('#langBtn').innerHTML = `${L.flagSvg}<span class="lang-code">${L.short}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>`;
  $('#langBtn').setAttribute('aria-label', `${t('lang.menu')}: ${L.name}`);
  $('#langMenu').setAttribute('aria-label', t('lang.menu'));
  $('#langMenu').innerHTML = LANGS.map(l => `<li role="option" id="lo-${l.code}" tabindex="-1" data-lang="${l.code}" lang="${l.code}" dir="ltr" aria-selected="${l.code === lang}">${l.flagSvg}<span dir="${l.dir}">${l.name}</span><span class="lang-code-sm">${l.code.toUpperCase()}</span>${l.code === lang ? '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</li>`).join('');
}
function bindLangMenu() {
  const btn = $('#langBtn'), menu = $('#langMenu');
  const items = () => $$('#langMenu [role="option"]');
  const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); (menu.querySelector('[aria-selected="true"]') || items()[0]).focus(); };
  const close = (focusBtn = true) => { if (menu.hidden) return; menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); };
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
  menu.addEventListener('click', e => { const li = e.target.closest('[data-lang]'); if (!li) return; close(); if (li.dataset.lang !== lang) setLang(li.dataset.lang); });
  menu.addEventListener('keydown', e => {
    const list = items(); const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement?.click(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
  });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('#lang')) close(false); });
}

function rerenderAll() {
  markLang(); renderStatic(); renderFilters(); renderTabs(); renderStack(); renderElev(); renderLegend(); renderCount();
  try { plan.refresh(); } catch (e) { console.warn('[app] plan.refresh:', e); }
  setPlanNote();
  if (S.view === 'list') renderList();
  if (dlgU().open) renderUnit();
  renderGallery();
  if ($('#lightbox').open) lbShow(G.lb.i);
  try { walk?.refreshTexts?.(); } catch (e) { /* HUD keeps previous texts */ }
  hero?.relayout?.();
  if (!$('#walkVeil').hidden) { $('#walkT').textContent = t($('#walkVeil').classList.contains('failed') ? 'walk.unavailable' : 'walk.loading'); }
}

// Deep links: #u=B3-12-04 opens that flat's sheet; #b=B3&f=12 selects a building and floor in the finder.
function applyHash() {
  const h = location.hash || '';
  const m = h.match(/^#u=([\w-]+)/);
  if (m) { const u = unitById(m[1]); if (!u) return false; setFloor(u.building, u.floor); openUnit(u); return true; }
  if (/^#b=/.test(h)) {
    const q = new URLSearchParams(h.slice(1)), b = q.get('b');
    if (!BUILDINGS[b]) return false;
    setFloor(b, q.get('f') ? clampFloor(b, q.get('f')) : clampFloor(b, S.f), { scroll: true }); return true;
  }
  return false;
}

// ---------------------------------------------------------------- boot
async function boot() {
  appStyles();
  await loadSiblings();
  setLang(initialLang());
  try {
    plan = PL?.createPlan?.($('#plan'), {
      statusOf, matches: u => matches(u),
      onSelect: u => openUnit(u),
      onHover: u => hero?.highlightUnits(u ? [u.id] : (S.unit && dlgU().open ? [S.unit.id] : null)),
    }) || null;
  } catch (e) { console.warn('[app] floor plan:', e); plan = null; }
  if (!plan) {                                             // no floor-plan module: the list is the finder
    plan = NO_PLAN; S.view = 'list';
    $('#planWrap').hidden = true; $('#listWrap').hidden = false; $('#viewTabs [data-view="plan"]')?.setAttribute('hidden', '');
  }
  bindHeader(); bindFilters(); bindFinder(); bindUnit(); bindWalk(); bindGallery(); bindMap();
  rerenderAll();
  setFloor(S.b, S.f);
  onLangChange(rerenderAll);

  applyHash();
  addEventListener('hashchange', () => applyHash());

  loadGallery();
  // Reservations are read only in the CRM; reading the db on page load made claude.ai show a sign-in prompt to every visitor.
  if (false) BK?.loadReservations?.().then(ids => { if (!ids.size) return; ids.forEach(id => reserved.add(id)); plan.refresh(); renderStack(); if (S.view === 'list') renderList(); if (dlgU().open) renderUnit(); }).catch(() => {});

  const kick = () => {
    (window.requestIdleCallback ? requestIdleCallback(startHero, { timeout: 1500 }) : setTimeout(startHero, 400));
    if (!F.walk) return;
    setTimeout(() => onIdle(preloadWalkModules), 1500);           // fetch + compile the walkthrough's modules
    // then its textures (worker; cached in IndexedDB). Phones wait for a unit sheet (intent): the decoded textures of
    // one design weigh tens of MB until the walkthrough uses them.
    if (!dlgU().open && !matchMedia('(pointer: coarse)').matches) prewarmWalkFor(null, 4000);
  };
  if (document.readyState === 'complete') kick(); else addEventListener('load', kick, { once: true });
}
boot().catch(e => console.error('[app] boot failed:', e));
