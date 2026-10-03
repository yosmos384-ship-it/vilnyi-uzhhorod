// ЖК VILNYI — "construction progress" section (CONTRACT §6, task T09).
// Self-starting module: <script type="module" src="js/progress.js"></script>. Renders into #progressApp:
//   building status cards · "then / now" comparison · monthly timeline with photo thumbnails · own full-screen lightbox.
// Weight rules: only thumbnails (`photo.thumb`) are ever put in the page, all lazy; a month's thumbnails exist in the DOM
// only after it is paged in ("show more"); the large file (`photo.local`) is requested only when the lightbox shows it.
import { PROJECT, BUILDINGS } from './data.js';
import { PROGRESS } from './data-progress.js';
import { lang, dir, onLangChange } from './i18n.js';
import { pg, pgHas, PG_LOCALES } from './i18n-progress.js';

const PAGE_FIRST = 3;      // months rendered at start
const PAGE_MORE = 6;       // months added per "show more"
const STEPS = 6;           // step.0 … step.5 in the dictionary
const DEFAULT_AR = 9 / 16; // the monitoring photos are 1080 × 1920 phone shots

// Stage milestones per building: [first month it applies, step index, phrase key (i18n-progress `ph.*`)].
// Read off the published photos (data/progress.json → `description`, `buildings[n].observed`); the generated
// data-progress.js does not carry these yet. `PROGRESS.buildings[id].milestones` ([{ from, step, key }]) overrides this table.
const OBSERVED = {
  B1: [['2026-05', 0, 'site'], ['2026-06', 1, 'pit'], ['2026-07', 1, 'blinding'], ['2026-08', 1, 'slabRebar']],
  B2: [['2023-11', 1, 'slabRebar'], ['2023-12', 1, 'basement'], ['2024-03', 2, 'frame'], ['2024-08', 2, 'frameWalls'], ['2024-11', 2, 'frameWallsWindows'],
    ['2025-03', 3, 'topped'], ['2025-04', 4, 'insulation'], ['2025-08', 4, 'render'], ['2025-09', 4, 'facadeGlazing'], ['2025-11', 4, 'facadePodium'], ['2026-04', 4, 'podiumWalls']],
  B3: [['2023-07', 0, 'demolition'], ['2023-08', 0, 'clearing'], ['2023-10', 1, 'pit'], ['2024-03', 1, 'slabRebar'], ['2024-04', 1, 'slab'], ['2024-05', 1, 'basement'],
    ['2024-07', 2, 'frame'], ['2025-09', 2, 'frameWalls']],
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROMAN = ['I', 'II', 'III', 'IV'];
const isLocal = u => typeof u === 'string' && u !== '' && !/^([a-z][a-z0-9+.-]*:)?\/\//i.test(u);
const ICON = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

// ---------------------------------------------------------------- dates (Intl; month names are never in the dictionary)
const loc = () => PG_LOCALES[lang] || lang || 'uk-UA';
const asDate = iso => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1))) : null; };
function fmt(iso, opts) { const d = asDate(iso); if (!d) return ''; try { return new Intl.DateTimeFormat(loc(), { timeZone: 'UTC', ...opts }).format(d); } catch (e) { return String(iso); } }
const cap1 = s => (s ? s.charAt(0).toLocaleUpperCase(loc()) + s.slice(1) : s);
const monthName = iso => fmt(iso, { month: 'long' });
const monthYear = iso => `${monthName(iso)} ${String(iso).slice(0, 4)}`;       // nominative: "вересень 2026"
const dayLong = iso => fmt(iso, { day: 'numeric', month: 'long', year: 'numeric' });
const dayNum = iso => fmt(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
const whenOf = (iso, precision) => (precision === 'day' ? dayLong(iso) : cap1(monthYear(iso)));

// ---------------------------------------------------------------- data → model
const pickL = o => (o == null ? '' : typeof o === 'string' ? (lang === 'en' ? o : '') : (o[lang] || ''));   // only the current language, never a foreign fallback
const textOf = o => (o == null ? '' : typeof o === 'string' ? o : (o[lang] || (lang === 'uk' || lang === 'ru' ? o.uk : '') || ''));
const creditName = c => (pgHas('credit.' + c) ? pg('credit.' + c) : c);
const bNo = id => BUILDINGS?.[id]?.no ?? String(id).replace(/\D/g, '');
const bName = id => pg('building', { n: bNo(id) });

function milestones(bId) {
  const m = PROGRESS?.buildings?.[bId]?.milestones;
  if (Array.isArray(m) && m.length) return m.map(x => [String(x.from || '').slice(0, 7), +x.step || 0, x.key || '']).sort((a, b) => a[0].localeCompare(b[0]));
  return OBSERVED[bId] || [];
}
function stageAt(bId, ym) { let hit = null; for (const m of milestones(bId)) { if (m[0] <= ym) hit = m; else break; } return hit ? { step: hit[1], key: hit[2] } : null; }
const phrase = st => (st && st.key && pgHas('ph.' + st.key) ? pg('ph.' + st.key) : '');

function creditUrl(credit) {
  const k = String(credit || '').toLowerCase().replace(/[^a-z0-9]/g, ''); if (!k) return null;
  const urls = [...new Set([...(PROGRESS.timeline || []).map(t => t.source), ...(PROGRESS.sources || []).map(s => s.url)].filter(Boolean))];
  for (const u of urls) { try { if (new URL(u).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/g, '').startsWith(k)) return u; } catch (e) { /* not a URL */ } }
  return null;
}

function buildModel(dead) {
  const items = [], photos = [];
  const tl = [...(PROGRESS?.timeline || [])].filter(t => t && t.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const t of tl) {
    const item = { date: t.date, ym: String(t.date).slice(0, 7), precision: t.precision === 'day' ? 'day' : 'month', text: t.text, photos: [] };
    for (const p of t.photos || []) {
      if (!p || p.est) continue;
      const src = isLocal(p.local) ? p.local : isLocal(p.url) ? p.url : null;      // local files only — nothing is hot-linked (BRIEF addendum 1)
      if (!src || dead.has(src)) continue;
      const thumb = isLocal(p.thumb) ? p.thumb : src;
      // third tier (240 px wide, T31): timeline tiles only; cards, compare and the lightbox placeholder keep -thumb
      const ph = { src, thumb, small: /-thumb\.jpg$/.test(thumb) ? thumb.replace(/-thumb\.jpg$/, '-s.jpg') : thumb, b: p.building, credit: p.credit || '', ar: p.w > 0 && p.h > 0 ? p.w / p.h : 0,
        date: p.date || t.date, precision: p.date ? 'day' : item.precision, ym: item.ym, desc: p.desc ?? p.description ?? null, item, i: photos.length };
      item.photos.push(ph); photos.push(ph);
    }
    if (item.photos.length || textOf(item.text)) items.push(item);
  }
  return { items, photos };
}
// Per-building view of the photos that are still alive. `months` is oldest → newest, each with the first-listed photo of that
// month (the source lists a building's monitoring angles in a fixed order, so this stays close to one viewpoint).
function buildBuildings(photos, alive) {
  const ids = Object.keys(BUILDINGS || {}).length ? Object.keys(BUILDINGS) : Object.keys(PROGRESS?.buildings || {});
  return ids.map(id => {
    const mine = photos.filter(p => p.b === id && alive(p));
    const months = []; for (let k = mine.length - 1; k >= 0; k--) { const p = mine[k]; const last = months[months.length - 1]; if (last && last.ym === p.ym) last.photo = p; else months.push({ ym: p.ym, photo: p }); }
    return { id, info: { ...(BUILDINGS?.[id] || {}), ...(PROGRESS?.buildings?.[id] || {}) }, photos: mine, months };
  });
}

// ---------------------------------------------------------------- lightbox (one per page, built on first use)
let LB = null;
function lightbox() {
  if (LB) return LB;
  const d = document.createElement('dialog'); d.className = 'pg-lb';
  d.innerHTML = `<div class="pg-lb-bar"><span class="pg-lb-n"></span><span class="pg-lb-ttl"></span><button type="button" class="icon-btn pg-lb-x" data-lb="close">${ICON.x}</button></div>
<div class="pg-lb-stage"><img class="pg-lb-img" alt="" draggable="false"><span class="pg-lb-load" role="status"></span></div>
<button type="button" class="icon-btn pg-lb-nav pg-lb-prev" data-lb="prev">${ICON.prev}</button>
<button type="button" class="icon-btn pg-lb-nav pg-lb-next" data-lb="next">${ICON.next}</button>
<div class="pg-lb-cap"><p class="pg-lb-text"></p><p class="pg-lb-credit"></p></div>`;
  document.body.append(d);
  const $ = s => d.querySelector(s), img = $('.pg-lb-img'), stage = $('.pg-lb-stage');
  const S = { list: [], i: 0, token: 0, big: null, ret: null, onDead: null };
  const drop = () => { if (S.big) { S.big.onload = S.big.onerror = null; S.big.src = ''; S.big = null; } };

  function label() {
    const p = S.list[S.i]; if (!p) return;
    d.setAttribute('aria-label', pg('lb.label'));
    $('.pg-lb-x').setAttribute('aria-label', pg('lb.close')); $('.pg-lb-prev').setAttribute('aria-label', pg('lb.prev')); $('.pg-lb-next').setAttribute('aria-label', pg('lb.next'));
    $('.pg-lb-load').textContent = pg('lb.loading');
    $('.pg-lb-n').textContent = pg('lb.of', { i: S.i + 1, n: S.list.length });
    const when = whenOf(p.date, p.precision);
    $('.pg-lb-ttl').innerHTML = `<b>${esc(bName(p.b))}</b><span>${esc(when)}</span>`;
    const text = pickL(p.desc) || phrase(stageAt(p.b, p.ym));
    $('.pg-lb-text').textContent = text; $('.pg-lb-text').hidden = !text;
    const url = creditUrl(p.credit), cr = esc(pg('credit', { c: creditName(p.credit) }));
    $('.pg-lb-credit').innerHTML = p.credit ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${cr}</a>` : cr) : '';
    img.alt = [bName(p.b), when, text].filter(Boolean).join(' — ');
    const multi = S.list.length > 1; $('.pg-lb-prev').hidden = !multi; $('.pg-lb-next').hidden = !multi;
  }
  function show(i) {
    const n = S.list.length; if (!n) { close(); return; }
    S.i = ((i % n) + n) % n; const p = S.list[S.i], my = ++S.token;
    drop(); label();
    img.style.transform = '';
    img.src = p.thumb; img.classList.add('is-thumb'); stage.classList.add('is-loading');   // the thumbnail is already cached: instant picture, sharp one follows
    const big = new Image(); S.big = big; big.decoding = 'async';
    big.onload = () => { if (my !== S.token) return; S.big = null; img.src = p.src; img.classList.remove('is-thumb'); stage.classList.remove('is-loading'); };
    big.onerror = () => { if (my !== S.token) return; S.big = null; S.list.splice(S.i, 1); try { S.onDead?.(p); } catch (e) { /* ignore */ } show(Math.min(S.i, S.list.length - 1)); };
    big.src = p.src;
  }
  function open(list, i, onDead) {
    if (!list || !list.length) return;
    S.list = list.slice(); S.onDead = onDead || null; if (!d.open) S.ret = document.activeElement;
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
    document.documentElement.classList.add('modal-open');
    show(i); $('.pg-lb-x').focus({ preventScroll: true });
  }
  function close() {
    S.token++; drop();
    if (d.open) { try { d.close(); } catch (e) { d.removeAttribute('open'); } }
    img.removeAttribute('src');
    if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('modal-open');
    const r = S.ret; S.ret = null; if (r && r.isConnected) r.focus?.({ preventScroll: true });
  }
  const step = k => show(S.i + k);
  d.addEventListener('cancel', e => { e.preventDefault(); close(); });
  d.addEventListener('click', e => {
    const a = e.target.closest('[data-lb]')?.dataset.lb;
    if (a === 'close') close(); else if (a === 'prev') step(-1); else if (a === 'next') step(1);
    else if (e.target === d || e.target === stage || e.target.closest('.pg-lb-bar, .pg-lb-cap') && !e.target.closest('a, button')) close();
  });
  d.addEventListener('keydown', e => {
    const f = dir === 'rtl' ? -1 : 1;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(f); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-f); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); } else if (e.key === 'End') { e.preventDefault(); show(S.list.length - 1); }
  });
  // swipe (touch / pen): the picture follows the finger; a horizontal throw of 48 px changes the photo
  let sw = null;
  stage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || !e.isPrimary) return; sw = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0 }; });
  stage.addEventListener('pointermove', e => {
    if (!sw || e.pointerId !== sw.id) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { sw.dx = dx; img.style.transform = `translateX(${dx}px)`; }
  });
  const end = e => {
    if (!sw || e.pointerId !== sw.id) return; const dx = e.type === 'pointercancel' ? 0 : e.clientX - sw.x, dy = e.clientY - sw.y; sw = null; img.style.transform = '';
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2 && S.list.length > 1) step((dx < 0 ? 1 : -1) * (dir === 'rtl' ? -1 : 1));
  };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  LB = { open, close, relabel: () => { if (d.open) label(); }, el: d, get isOpen() { return d.open; } };
  return LB;
}

// ---------------------------------------------------------------- section
function ensureHost(host) {
  if (host) return host;
  const sec = document.getElementById('progress'); if (!sec) return null;
  let app = sec.querySelector('#progressApp, .pg-app'); if (app) return app;
  const wrap = sec.querySelector('.wrap') || sec.appendChild(Object.assign(document.createElement('div'), { className: 'wrap' }));
  app = Object.assign(document.createElement('div'), { className: 'pg-app', id: 'progressApp' }); wrap.append(app); return app;
}
function ensureHead(sec, host) {
  if (!sec) return;
  if (!sec.querySelector('[data-pg="title"]')) {
    const head = document.createElement('div'); head.className = 'sec-head';
    const hid = sec.getAttribute('aria-labelledby') || 'progress-h';
    head.innerHTML = `<p class="eyebrow" data-pg="eyebrow"></p><h2 id="${esc(hid)}" class="h2" data-pg="title"></h2><p class="lead" data-pg="lead"></p>`;
    if (!sec.getAttribute('aria-labelledby') && !document.getElementById(hid)) sec.setAttribute('aria-labelledby', hid);
    host.before(head);
  }
}

export function initProgress(host = document.getElementById('progressApp')) {
  host = ensureHost(host); if (!host) return null;
  if (host._pg) return host._pg;
  const sec = host.closest('#progress') || host.closest('section');
  const navLinks = () => document.querySelectorAll('.nav-progress');
  const hide = () => { if (sec) sec.hidden = true; navLinks().forEach(a => { a.hidden = true; }); };
  if (PROJECT?.features?.progress === false || !PROGRESS || !(PROGRESS.timeline || []).length) { hide(); return null; }
  host.classList.add('pg-app');

  const dead = new Set();
  const st = { filter: 'all', shown: PAGE_FIRST, cmpB: null, cmpI: 0 };
  let M = null, B = [], off = null, raf = 0;

  const alive = p => !dead.has(p.src);
  const filtered = () => M.items.filter(it => (st.filter === 'all' ? it.photos.some(alive) || !!textOf(it.text) : it.photos.some(p => p.b === st.filter && alive(p))));
  const lbList = () => M.photos.filter(p => alive(p) && (st.filter === 'all' || p.b === st.filter));
  // a file that is missing or broken: the photo disappears everywhere (tile, card, comparison, lightbox list).
  // M.photos keeps its indices (the tiles' data-i point into it); only the derived views are refreshed.
  function kill(p) {
    if (!p || dead.has(p.src)) return; dead.add(p.src);
    const tile = host.querySelector(`.pg-photo[data-i="${p.i}"]`);
    if (tile) { const group = tile.closest('.pg-group'), item = tile.closest('.pg-item'); tile.remove();
      if (group && !group.querySelector('.pg-photo')) group.remove();
      if (item && !item.querySelector('.pg-photo') && !item.querySelector('.pg-text')) item.remove(); }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(refreshAux);
  }

  // ---- pieces
  function cardHtml(b) {
    const info = b.info, status = ['prep', 'building', 'done'].includes(info.status) ? info.status : 'building';
    const latest = b.photos[0] || null;
    const stg = latest ? stageAt(b.id, latest.ym) : null;
    const cur = status === 'done' ? STEPS : stg ? stg.step : status === 'prep' ? 0 : -1;      // -1: stage not known — no stepper
    const stepName = cur >= 0 && cur < STEPS ? pg('step.' + cur) : '';
    const steps = cur < 0 ? '' : `<ol class="pg-steps" aria-label="${esc(cur >= STEPS ? pg('status.done') : pg('stepOf', { i: cur + 1, n: STEPS }) + ': ' + stepName)}">${
      Array.from({ length: STEPS }, (_, k) => `<li class="${k < cur ? 'is-done' : k === cur ? 'is-cur' : ''}" title="${esc(pg('step.' + k))}"></li>`).join('')}</ol>
      ${cur < STEPS ? `<p class="pg-b-step"><span>${esc(pg('stepOf', { i: cur + 1, n: STEPS }))}</span><b>${esc(stepName)}</b></p>` : ''}`;
    const obs = phrase(stg);
    const del = info.delivery && info.delivery.q && info.delivery.year
      ? `<div><dt>${esc(pg('delivery'))}</dt><dd>${esc(pg('q', { q: info.delivery.q, r: ROMAN[info.delivery.q - 1] || info.delivery.q, y: info.delivery.year }))}${info.delivery.confirmed ? '' : ` <i>${esc(pg('deliveryTbc'))}</i>`}</dd></div>` : '';
    const first = b.months[0];
    const pic = latest
      ? `<button type="button" class="pg-b-ph" data-card="${esc(b.id)}" aria-label="${esc(pg('open') + ': ' + bName(b.id) + ', ' + whenOf(latest.date, latest.precision))}">
           <img src="${esc(latest.thumb)}" alt="" loading="lazy" decoding="async" width="360" height="640" data-src="${esc(latest.src)}">
           <span class="pg-b-phcap"><i>${esc(pg('latest'))}</i>${esc(dayNum(latest.date))}</span><span class="pg-zoom">${ICON.zoom}</span></button>`
      : `<div class="pg-b-ph pg-b-none" aria-hidden="true"><span>${esc(bNo(b.id))}</span></div>`;
    return `<article class="pg-b is-${status}" data-b="${esc(b.id)}">${pic}
      <div class="pg-b-body">
        <header class="pg-b-head"><h3 class="pg-b-name">${esc(bName(b.id))}</h3><span class="pg-st is-${status}">${esc(pg('status.' + status))}</span></header>
        <p class="pg-b-floors">${info.floors ? esc(pg('floors', { n: info.floors })) : ''}${info.statusDate ? `<span>${esc(pg('statusAsOf', { d: dayNum(info.statusDate) }))}</span>` : ''}</p>
        <div class="pg-b-stage">${steps}${obs ? `<p class="pg-b-obs">${esc(obs)}<span> — ${esc(pg('stageBasis', { d: dayNum(latest.date) }))}</span></p>` : ''}${latest ? '' : `<p class="pg-b-obs pg-b-nophoto">${esc(pg('noPhoto'))}</p>`}</div>
        <dl class="pg-b-meta">${del}${latest ? `<div><dt>${esc(pg('photosN', { n: b.photos.length }))}</dt><dd>${esc(cap1(monthYear(first.photo.date)))} — ${esc(monthYear(latest.date))}</dd></div>` : ''}</dl>
        ${latest ? `<button type="button" class="pg-b-view" data-view="${esc(b.id)}">${esc(pg('view'))}${ICON.arrow}</button>` : ''}
      </div></article>`;
  }

  function legendHtml() {
    return `<div class="pg-legend"><span class="pg-legend-t">${esc(pg('stepsLegend'))}</span><ol>${Array.from({ length: STEPS }, (_, k) => `<li>${esc(pg('step.' + k))}</li>`).join('')}</ol></div>`;
  }

  const cmpBuildings = () => B.filter(b => b.months.length >= 2);
  function cmpHtml() {
    const list = cmpBuildings(); if (!list.length) return '';
    let b = list.find(x => x.id === st.cmpB);
    if (!b) {   // default: the building that has come furthest, then the longest record
      b = [...list].sort((x, y) => ((stageAt(y.id, y.photos[0].ym)?.step ?? -1) - (stageAt(x.id, x.photos[0].ym)?.step ?? -1)) || (y.months.length - x.months.length))[0];
      st.cmpB = b.id; st.cmpI = 0;
    }
    const max = b.months.length - 2; st.cmpI = Math.min(Math.max(0, st.cmpI), max);
    const then = b.months[st.cmpI].photo, now = b.months[b.months.length - 1].photo;
    const pane = (p, k) => `<figure class="pg-cmp-fig pg-cmp-${k}">
        <button type="button" class="pg-cmp-ph" data-cmp="${k}" aria-label="${esc(pg('open') + ': ' + bName(b.id) + ', ' + whenOf(p.date, p.precision))}">
          <img src="${esc(p.thumb)}" alt="" loading="lazy" decoding="async" width="360" height="640" data-src="${esc(p.src)}"><span class="pg-tag">${esc(pg('cmp.' + k))}</span><span class="pg-zoom">${ICON.zoom}</span></button>
        <figcaption><b>${esc(cap1(monthYear(p.date)))}</b><span>${esc(phrase(stageAt(b.id, p.ym)))}</span><small>${esc(pg('credit', { c: creditName(p.credit) }))}</small></figcaption></figure>`;
    return `<div class="pg-cmp-side">
        <h3 class="pg-h3">${pg('cmp.title')}</h3><p class="pg-cmp-lead">${esc(pg('cmp.lead'))}</p>
        ${list.length > 1 ? `<div class="pg-cmp-tabs seg" role="tablist" aria-label="${esc(pg('filter'))}">${list.map(x => `<button type="button" role="tab" data-cmpb="${esc(x.id)}" aria-selected="${x.id === b.id}">${esc(bName(x.id))}</button>`).join('')}</div>` : ''}
        ${max > 0 ? `<label class="pg-range"><span>${esc(pg('cmp.pick'))}<b>${esc(cap1(monthYear(then.date)))}</b></span>
          <input type="range" min="0" max="${max}" step="1" value="${st.cmpI}" data-cmprange aria-valuetext="${esc(monthYear(then.date))}">
          <span class="pg-range-ends"><i>${esc(monthYear(b.months[0].photo.date))}</i><i>${esc(monthYear(b.months[max].photo.date))}</i></span></label>` : ''}
      </div>
      <div class="pg-cmp-pair">${pane(then, 'then')}${pane(now, 'now')}</div>`;
  }

  function itemHtml(it) {
    const groups = []; for (const p of it.photos) { if (!alive(p) || (st.filter !== 'all' && p.b !== st.filter)) continue; let g = groups.find(x => x.b === p.b); if (!g) groups.push(g = { b: p.b, photos: [] }); g.photos.push(p); }
    const order = B.map(b => b.id); groups.sort((a, b) => order.indexOf(a.b) - order.indexOf(b.b));
    const text = st.filter === 'all' ? textOf(it.text) : '';
    if (!groups.length && !text) return '';
    const when = it.precision === 'day' ? dayNum(it.date) : '';
    return `<li class="pg-item" data-date="${esc(it.date)}" data-ym="${esc(it.ym)}">
      <div class="pg-when"><h4 class="pg-title">${esc(cap1(monthName(it.date)))} <span>${esc(it.ym.slice(0, 4))}</span></h4>${when ? `<time class="pg-date" datetime="${esc(it.date)}">${esc(when)}</time>` : ''}</div>
      <div class="pg-body">${text ? `<p class="pg-text">${esc(text)}</p>` : ''}
        <div class="pg-groups">${groups.map(g => {
    const ph = phrase(stageAt(g.b, it.ym));
    return `<section class="pg-group" data-b="${esc(g.b)}"><header class="pg-g-head"><b>${esc(bName(g.b))}</b>${ph ? `<span>${esc(ph)}</span>` : ''}</header>
          <div class="pg-photos">${g.photos.map(p => {
      const lbl = [bName(p.b), whenOf(p.date, p.precision), pickL(p.desc) || ph, pg('credit', { c: creditName(p.credit) })].filter(Boolean).join('. ');
      return `<button type="button" class="pg-photo" data-i="${p.i}" style="--ar:${(p.ar || DEFAULT_AR).toFixed(4)}" aria-label="${esc(lbl)}"><img src="${esc(p.small)}" alt="" loading="lazy" decoding="async" width="${Math.round(640 * (p.ar || DEFAULT_AR))}" height="640"><span class="pg-cr">${esc(creditName(p.credit))}</span></button>`;
    }).join('')}</div></section>`;
  }).join('')}</div>
      </div></li>`;
  }

  function moreHtml(total) {
    const shown = Math.min(st.shown, total), left = total - shown;
    return `<p class="pg-shown">${esc(pg('shown', { a: shown, b: total }))}</p>${left > 0 ? `<button type="button" class="btn gold-outline pg-more-btn" data-more>${esc(pg('more', { k: Math.min(PAGE_MORE, left) }))}</button>` : ''}`;
  }
  function timelineHtml() {
    const items = filtered(), withPhotos = B.filter(b => b.photos.length);
    const years = [...new Set(items.map(it => it.ym.slice(0, 4)))];
    return `<div class="pg-tl-head">
        <h3 class="pg-h3">${pg('tl.title')}</h3>
        <div class="pg-tl-tools">
          ${withPhotos.length > 1 ? `<div class="pg-filter seg" role="tablist" aria-label="${esc(pg('filter'))}"><button type="button" role="tab" data-b="all" aria-selected="${st.filter === 'all'}">${esc(pg('all'))}</button>${withPhotos.map(b => `<button type="button" role="tab" data-b="${esc(b.id)}" aria-selected="${st.filter === b.id}">${esc(bName(b.id))}</button>`).join('')}</div>` : ''}
          ${years.length > 1 ? `<div class="pg-years" role="group" aria-label="${esc(pg('years'))}">${years.map(y => `<button type="button" data-year="${esc(y)}">${esc(y)}</button>`).join('')}</div>` : ''}
        </div></div>
      <ol class="pg-timeline">${items.slice(0, st.shown).map(itemHtml).join('')}</ol>
      <div class="pg-more">${moreHtml(items.length)}</div>`;
  }

  function footHtml() {
    const live = M.photos.filter(alive), newest = live[0]?.date || M.items[0]?.date || PROGRESS.updatedAt;
    const credits = [...new Set(live.map(p => p.credit).filter(Boolean))];
    const src = credits.map(c => { const u = creditUrl(c); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(creditName(c))}</a>` : esc(creditName(c)); }).join(', ');
    return `<p class="pg-updated">${esc(pg('updated', { d: dayLong(newest) }))}</p><p class="pg-planned">${esc(pg('plannedNote'))}</p>${src ? `<p class="pg-sources">${esc(pg('sources'))}: ${src}</p>` : ''}`;
  }

  // ---- render
  function head() {
    if (!sec) return;
    const set = (k, html, raw) => { const el = sec.querySelector(`[data-pg="${k}"]`); if (el) { if (raw) el.innerHTML = html; else el.textContent = html; } };
    const live = M.photos.filter(alive), oldest = live[live.length - 1], newest = live[0];
    set('eyebrow', pg('eyebrow')); set('title', pg('title'), true);
    set('lead', oldest ? pg('lead', { n: live.length, m: new Set(live.map(p => p.ym)).size, from: monthYear(oldest.date), to: monthYear(newest.date) }) : '');
  }
  function render() {
    M = buildModel(dead); B = buildBuildings(M.photos, alive);
    if (!M.items.length) { host.innerHTML = ''; hide(); return; }
    ensureHead(sec, host); head();
    const cmp = cmpHtml();
    host.innerHTML = `<div class="pg-buildings">${B.map(cardHtml).join('')}</div>${legendHtml()}
      ${cmp ? `<div class="pg-cmp">${cmp}</div>` : ''}
      <div class="pg-tl">${timelineHtml()}</div>
      <footer class="pg-foot">${footHtml()}</footer>`;
    host.dir = dir;
    if (sec) sec.hidden = false; navLinks().forEach(a => { a.hidden = false; });
    LB?.relabel();
  }
  // after a photo failed to load: cards, comparison, counts and footer are rebuilt; the timeline DOM is left alone
  function refreshAux() {
    B = buildBuildings(M.photos, alive);
    if (!filtered().length && !M.items.some(it => it.photos.some(alive) || textOf(it.text))) { host.innerHTML = ''; hide(); return; }
    head();
    const q = s => host.querySelector(s);
    if (q('.pg-buildings')) q('.pg-buildings').innerHTML = B.map(cardHtml).join('');
    const cmp = cmpHtml(); if (q('.pg-cmp')) { if (cmp) q('.pg-cmp').innerHTML = cmp; else q('.pg-cmp').remove(); }
    if (q('.pg-foot')) q('.pg-foot').innerHTML = footHtml();
    if (!q('.pg-item')) renderTimeline();
  }
  function renderTimeline() { const el = host.querySelector('.pg-tl'); if (el) el.innerHTML = timelineHtml(); }
  const renderCmp = () => { const el = host.querySelector('.pg-cmp'); if (el) el.innerHTML = cmpHtml(); };

  function showMore(upTo) {
    const items = filtered(), from = Math.min(st.shown, items.length);
    st.shown = Math.min(items.length, Math.max(from + PAGE_MORE, upTo || 0));
    host.querySelector('.pg-timeline')?.insertAdjacentHTML('beforeend', items.slice(from, st.shown).map(itemHtml).join(''));
    const m = host.querySelector('.pg-more'); if (m) m.innerHTML = moreHtml(items.length);
    return from;
  }
  const scrollTo = el => { if (!el) return; const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); };
  function setFilter(b, scroll) {
    st.filter = b; st.shown = PAGE_FIRST; renderTimeline();
    if (scroll) scrollTo(host.querySelector('.pg-tl')); else host.querySelector(`.pg-filter [data-b="${CSS.escape(b)}"]`)?.focus({ preventScroll: true });
  }

  // ---- events
  const onClick = e => {
    const el = e.target.closest('button'); if (!el || !host.contains(el)) return;
    if (el.dataset.i != null) { const p = M.photos[+el.dataset.i], L = lbList(); lightbox().open(L, Math.max(0, L.indexOf(p)), kill); }
    else if (el.dataset.card) { const L = M.photos.filter(p => p.b === el.dataset.card); lightbox().open(L, 0, kill); }
    else if (el.dataset.cmp) { const b = B.find(x => x.id === st.cmpB); if (!b) return; const p = el.dataset.cmp === 'now' ? b.months[b.months.length - 1].photo : b.months[st.cmpI].photo; lightbox().open(b.photos, Math.max(0, b.photos.indexOf(p)), kill); }
    else if (el.dataset.view) setFilter(el.dataset.view, true);
    else if (el.dataset.cmpb) { st.cmpB = el.dataset.cmpb; st.cmpI = 0; renderCmp(); host.querySelector(`[data-cmpb="${CSS.escape(st.cmpB)}"]`)?.focus({ preventScroll: true }); }
    else if (el.dataset.b && el.closest('.pg-filter')) setFilter(el.dataset.b, false);
    else if (el.dataset.more != null) { const from = showMore(); host.querySelectorAll('.pg-item')[from]?.querySelector('.pg-photo')?.focus({ preventScroll: true }); }
    else if (el.dataset.year) {
      const items = filtered(), k = items.findIndex(it => it.ym.startsWith(el.dataset.year)); if (k < 0) return;
      if (k >= st.shown) showMore(k + 2);
      scrollTo(host.querySelector(`.pg-item[data-ym="${CSS.escape(items[k].ym)}"]`));
    }
  };
  const onInput = e => {
    if (!e.target.matches('[data-cmprange]')) return;
    const b = B.find(x => x.id === st.cmpB); if (!b) return;
    st.cmpI = Math.min(Math.max(0, +e.target.value || 0), b.months.length - 2);
    const p = b.months[st.cmpI].photo, fig = host.querySelector('.pg-cmp-then'); if (!fig) return;
    const img = fig.querySelector('img'); img.src = p.thumb; img.dataset.src = p.src;
    fig.querySelector('figcaption b').textContent = cap1(monthYear(p.date)); fig.querySelector('figcaption span').textContent = phrase(stageAt(b.id, p.ym));
    fig.querySelector('figcaption small').textContent = pg('credit', { c: creditName(p.credit) });
    fig.querySelector('button').setAttribute('aria-label', pg('open') + ': ' + bName(b.id) + ', ' + whenOf(p.date, p.precision));
    host.querySelector('.pg-range b').textContent = cap1(monthYear(p.date)); e.target.setAttribute('aria-valuetext', monthYear(p.date));
  };
  const onError = e => {
    const img = e.target; if (!(img instanceof HTMLImageElement) || !host.contains(img)) return;
    const tile = img.closest('.pg-photo'), src = img.dataset.src;
    const p = tile ? M.photos[+tile.dataset.i] : M.photos.find(x => x.src === src);
    if (p) kill(p); else if (tile) tile.remove();
  };
  const onLoad = e => {   // data without w/h: take the real ratio from the loaded thumbnail (row height is fixed, so nothing moves vertically)
    const img = e.target; if (!(img instanceof HTMLImageElement)) return; const tile = img.closest('.pg-photo'); if (!tile || !img.naturalWidth) return;
    const ar = img.naturalWidth / img.naturalHeight, p = M.photos[+tile.dataset.i];
    if (p && !p.ar) p.ar = ar;
    if (Math.abs(ar - parseFloat(tile.style.getPropertyValue('--ar'))) > 0.02) tile.style.setProperty('--ar', ar.toFixed(4));
  };
  host.addEventListener('click', onClick); host.addEventListener('input', onInput);
  host.addEventListener('error', onError, true); host.addEventListener('load', onLoad, true);

  render();
  off = onLangChange(() => { try { render(); } catch (e) { console.error('[progress]', e); } });

  const api = {
    refresh: () => render(),
    dispose: () => {
      off?.(); cancelAnimationFrame(raf);
      host.removeEventListener('click', onClick); host.removeEventListener('input', onInput);
      host.removeEventListener('error', onError, true); host.removeEventListener('load', onLoad, true);
      LB?.close(); host.innerHTML = ''; delete host._pg;
    },
  };
  host._pg = api;
  return api;
}

// ---------------------------------------------------------------- self-start (never throws into the page)
function boot() { try { if (document.getElementById('progressApp') || document.getElementById('progress')) initProgress(); } catch (e) { console.error('[progress]', e); const s = document.getElementById('progress'); if (s) s.hidden = true; } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
