#!/usr/bin/env node
// ЖК VILNYI — static, pre-rendered SEO / GEO pages (no JavaScript needed to read them).
//
//   node seo-bot/build.mjs [--root <site dir>] [--today YYYY-MM-DD] [--dry]
//
// Reads ONLY the published site: js/data.js (+ generated data modules), js/i18n/<lang>.{site,ui}.js, rate.json,
// assets/gallery/manifest.json, seo-bot/{i18n.mjs, pois.json, config.json, images.json}. Writes:
//   <lang>/…/index.html for uk en he ro de fr it (home, apartments, 1-/2-/3-room, 122 layouts, 4 buildings, location,
//   construction, parking, faq, contacts, facts, guide), facts/index.html (uk + en plain facts), sitemap.xml (index) +
//   sitemap-<lang>.xml + sitemap-root.xml, robots.txt, llms.txt, llms-full.txt, seo-bot/state.json (hash + lastmod per URL).
// Never writes rate.json, CNAME, index.html or anything under js/, css/, assets/ (images are made by make-og.py).
// Prices: the site's one rule (data.js): round(1300 $ × NBU rate) ₴ per m² × total area — exactly what the 3D site shows.
// lastmod of a URL changes only when its rendered HTML changes; `ch` (content hash at a fixed dummy rate) tells the
// IndexNow step whether the change was more than the daily price update.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', path.join(HERE, '..')));
const DRY = argv.includes('--dry');
const kyivToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
const TODAY = arg('--today', kyivToday());

const D = await import(pathToFileURL(path.join(ROOT, 'js', 'data.js')).href);
const { S, LANGS } = await import(pathToFileURL(path.join(HERE, 'i18n.mjs')).href);
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const POIS = JSON.parse(fs.readFileSync(path.join(HERE, 'pois.json'), 'utf8')).pois;
const IMG = JSON.parse(fs.readFileSync(path.join(HERE, 'images.json'), 'utf8'));
const GALLERY = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'gallery', 'manifest.json'), 'utf8'));
const BASE = CFG.base.replace(/\/$/, '');
const SITE = {}, UI = {};
for (const l of LANGS) {
  SITE[l] = (await import(pathToFileURL(path.join(ROOT, 'js', 'i18n', `${l}.site.js`)).href)).default;
  UI[l] = (await import(pathToFileURL(path.join(ROOT, 'js', 'i18n', `${l}.ui.js`)).href)).default;
}
const P = D.PROJECT, C = P.contact;

// ---------------------------------------------------------------- rate (read only; the NBU bot owns rate.json)
let RATE = { rate: D.RATE_FALLBACK.rate, date: D.RATE_FALLBACK.date };
try {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'rate.json'), 'utf8'));
  if (r.rate > 20 && r.rate < 200 && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) RATE = { rate: r.rate, date: r.date };
} catch (e) { console.warn('rate.json not readable — fallback rate', RATE); }

// ---------------------------------------------------------------- helpers
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
const loc = l => S[l].locale.replace('_', '-');
const nf2 = l => new Intl.NumberFormat(loc(l), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = (l, d = 0) => new Intl.NumberFormat(loc(l), { maximumFractionDigits: d });
const area = (l, a) => nf2(l).format(a);
const M2 = l => (l === 'uk' ? 'м²' : l === 'he' ? 'מ״ר' : 'm²');
const uah = (l, n) => nf(l).format(Math.round(n)) + '\u00a0₴';
const usd = (l, n) => (l === 'en' || l === 'he' ? '$' + nf(l).format(Math.round(n)) : nf(l).format(Math.round(n)) + '\u00a0$');
const rateTxt = (l, r) => new Intl.NumberFormat(loc(l), { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(r);
const dateTxt = (l, iso) => new Intl.DateTimeFormat(loc(l), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const monthTxt = (l, iso) => new Intl.DateTimeFormat(loc(l), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 7) + '-15T12:00:00Z'));
const T = (l, k, v) => fill(S[l][k] ?? k, v);
const ui = (l, k, v) => fill(UI[l][k] ?? UI.en[k] ?? k, v);
const st = (l, k, v) => fill(SITE[l][k] ?? SITE.en[k] ?? k, v);
const qTxt = (l, d) => ui(l, 'delivery.q', { q: d.q, y: d.year });
const ranges = nums => { const a = [...new Set(nums)].sort((x, y) => x - y), out = []; for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`); i = j; } return out.join(', '); };
const slug = k => k.toLowerCase();
const url = (l, key = '') => `${BASE}/${l}/${key}`;
const rel = (l, key = '') => `/${l}/${key}`;
const appHref = (l, hash = '') => (l === 'uk' ? '/' : `/?lang=${l}`) + hash;
const waHref = l => `https://wa.me/${C.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(st(l, 'wa.greeting'))}`;
const phoneTxt = p => p.replace(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/, '+38 0$1 $2 $3 $4');
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- facts derived from data.js
const B_IDS = D.B_IDS, BLD = D.BUILDINGS;
const TYPES = Object.values(D.TYPES).sort((a, b) => a.key.localeCompare(b.key));
const unitsOf = key => D.UNITS.filter(u => u.type === key).sort((a, b) => a.floor - b.floor || a.apNo - b.apNo);
const byRooms = r => D.UNITS.filter(u => u.rooms === r);
const minmax = arr => [Math.min(...arr), Math.max(...arr)];
const STATUS_DATE = BLD.B1.statusDate;
const PARK = { car: P.totals.parking, tandem: P.totals.parkingTandem, std: P.totals.parking - P.totals.parkingTandem, moto: P.totals.parkingMoto, ev: P.totals.evCharging, ramps: (D.RAMPS || []).length || 2 };
const roomName = (l, r) => ui(l, r.nk || 'room.other');
const facingTxt = (l, u) => (u.facings || [u.facing]).map(f => ui(l, 'face.' + f)).join(', ');
const imgSize = p => IMG.sizes[p] || null;
const galleryItem = src => GALLERY.find(g => g.src === src);
const IMGS = { home: 'assets/gallery/aerial-southeast.jpg', apartments: 'assets/gallery/night-corner-view.jpg', B1: 'assets/gallery/street-east-buildings-2-1.jpg', B2: 'assets/gallery/commercial-podium-corner.jpg', B3: 'assets/gallery/tower-and-spa.jpg', B4: 'assets/gallery/street-south-buildings-4-2.jpg', location: 'assets/gallery/day-corner-view.jpg', parking: 'assets/gallery/aerial-south.jpg', life: 'assets/web/lun-06.jpg' };
const OG = { home: 'home', apartments: 'apartments', B1: 'b1', B2: 'b2', B3: 'b3', B4: 'b4', location: 'location', parking: 'parking', progress: 'progress' };

// responsive <img> from the gallery's own WebP variants (640 / 1200 px); never the 2400 px original
function picture(l, src, { eager = false, sizes = '(max-width: 820px) 100vw, 820px', cls = '' } = {}) {
  const g = galleryItem(src); if (!g) return '';
  const vars = (g.variants || []).filter(v => imgSize(v[0]));
  if (!vars.length) return '';
  const big = vars[vars.length - 1][0], [w, h] = imgSize(big);
  const alt = g.caption?.[l] || g.caption?.en || '';
  return `<img${cls ? ` class="${cls}"` : ''} src="/${big}" srcset="${vars.map(v => `/${v[0]} ${v[1]}w`).join(', ')}" sizes="${sizes}" width="${w}" height="${h}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;
}

// ---------------------------------------------------------------- the flat's plan as inline SVG (from the real room polygons)
const KIND_FILL = { living: '#3a3226', kitchen: '#3a3226', bedroom: '#2f2a22', hall: '#26231e', bath: '#22303a', storage: '#26231e', dressing: '#26231e', loggia: '#25302a', balcony: '#25302a', terrace: '#25302a' };
function planSvg(l, key) {
  const I = D.ROOMS[key]; if (!I) return '';
  const all = [...I.rooms, ...I.outdoor];
  const pts = [...(I.outer || []), ...all.flatMap(r => r.poly)];
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const pad = 0.9, x0 = Math.min(...xs) - pad, z0 = Math.min(...zs) - pad, W = Math.max(...xs) + pad - x0, H = Math.max(...zs) + pad - z0;
  const f = n => +n.toFixed(2), poly = p => p.map(([x, z]) => `${f(x)},${f(z)}`).join(' ');
  const fs1 = Math.max(0.28, Math.min(0.42, Math.max(W, H) / 32));
  let s = `<svg class="plan" viewBox="${f(x0)} ${f(z0)} ${f(W)} ${f(H)}" role="img" aria-labelledby="plan-t" xmlns="http://www.w3.org/2000/svg"><title id="plan-t">${esc(T(l, 'planOf', { key }))}</title>`;
  for (const r of all) s += `<polygon points="${poly(r.poly)}" fill="${KIND_FILL[r.kind] || '#26231e'}" stroke="#8f7040" stroke-width="0.04"/>`;
  if (I.outer?.length) s += `<polygon points="${poly(I.outer)}" fill="none" stroke="#e6cc92" stroke-width="0.14" stroke-linejoin="round"/>`;
  for (const w of I.windows || []) if (w.pts?.length === 2) s += `<line x1="${f(w.pts[0][0])}" y1="${f(w.pts[0][1])}" x2="${f(w.pts[1][0])}" y2="${f(w.pts[1][1])}" stroke="#7fa3a8" stroke-width="0.12"/>`;
  for (const r of all) {
    const [cx, cz] = r.c || [r.poly.reduce((m, p) => m + p[0], 0) / r.poly.length, r.poly.reduce((m, p) => m + p[1], 0) / r.poly.length];
    const big = r.area >= 7;
    if (big) s += `<text x="${f(cx)}" y="${f(cz - fs1 * 0.35)}" font-size="${f(fs1 * 0.82)}" fill="#a89f8e" text-anchor="middle">${esc(roomName(l, r))}</text>`;
    s += `<text x="${f(cx)}" y="${f(cz + (big ? fs1 * 0.75 : fs1 * 0.35))}" font-size="${f(fs1)}" fill="#f3ede1" text-anchor="middle">${esc(area(l, r.area))}</text>`;
  }
  const rot = f((360 - D.COMPASS.negZ) % 360), nx = f(x0 + W - 0.75), nz = f(z0 + 0.95);
  s += `<g transform="translate(${nx} ${nz}) rotate(${rot})"><path d="M0,-0.55 L0.22,0.3 L0,0.16 L-0.22,0.3 Z" fill="#c9a96a"/><text x="0" y="-0.68" font-size="0.34" fill="#c9a96a" text-anchor="middle">${esc(T(l, 'north'))}</text></g>`;
  return s + '</svg>';
}

// ---------------------------------------------------------------- page shell
const CSS = `:root{--bg:#0b0a08;--panel:#17140f;--line:rgba(214,186,132,.2);--gold:#c9a96a;--gold-hi:#e6cc92;--text:#e9e2d4;--muted:#a89f8e;--ivory:#f3ede1}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Hebrew",sans-serif}
a{color:var(--gold-hi)}a:hover{color:var(--ivory)}img,svg{max-width:100%;height:auto}
.w{max-width:1100px;margin:0 auto;padding:0 16px}
.skip{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.skip:focus{width:auto;height:auto;clip:auto;top:8px;inset-inline-start:16px;background:var(--panel);padding:8px;z-index:9}
header{border-bottom:1px solid var(--line);background:#100e0b}
.hd{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding-top:10px;padding-bottom:10px}
.logo{display:inline-flex;align-items:center;gap:10px;color:var(--ivory);text-decoration:none;font:600 20px/1 Georgia,"Times New Roman",serif;letter-spacing:.08em;min-height:44px}
.logo img{width:96px;height:auto}
nav.m{display:flex;flex-wrap:wrap;gap:0 4px;flex:1 1 auto}nav.m a{display:inline-flex;align-items:center;min-height:44px;padding:0 8px;color:var(--text);text-decoration:none;font-size:15px}
nav.m a[aria-current]{color:var(--gold-hi)}
.cta{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border:1px solid var(--gold);color:var(--bg)!important;background:var(--gold);text-decoration:none;font-weight:600;border-radius:2px}
.cta.o{background:transparent;color:var(--gold-hi)!important}
.langs{display:flex;flex-wrap:wrap;gap:0 2px;font-size:14px}.langs a{display:inline-flex;align-items:center;min-height:44px;min-width:40px;justify-content:center;padding:0 4px;color:var(--muted);text-decoration:none}.langs a[aria-current]{color:var(--gold-hi);font-weight:600}
.bc{font-size:14px;color:var(--muted);padding-top:12px}.bc ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px}.bc li+li:before{content:"›";margin:0 6px;color:var(--gold)}.bc a{color:var(--muted)}
h1{font:500 clamp(28px,5vw,44px)/1.15 Georgia,"Times New Roman",serif;color:var(--ivory);margin:18px 0 12px}
h2{font:500 clamp(22px,3.5vw,30px)/1.2 Georgia,"Times New Roman",serif;color:var(--ivory);margin:36px 0 12px}
h3{font-size:18px;color:var(--ivory);margin:20px 0 8px}
.lead{font-size:18px;color:var(--text);max-width:760px}
.muted,.note{color:var(--muted);font-size:14px}
.hero{margin:12px 0 4px;border:1px solid var(--line)}.hero img{display:block;width:100%}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:16px 0}
.kv div{background:var(--panel);padding:12px 14px}.kv dt{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.06em}.kv dd{margin:2px 0 0;color:var(--ivory);font-size:17px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin:12px 0;padding:0;list-style:none}
.cards li{background:var(--panel);border:1px solid var(--line);padding:14px}.cards a.t{font-weight:600;text-decoration:none;font-size:17px}
.tw{overflow-x:auto;margin:12px 0;border:1px solid var(--line)}table{border-collapse:collapse;width:100%;font-size:15px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:start;vertical-align:top}th{color:var(--muted);font-weight:500;font-size:13px;text-transform:uppercase;letter-spacing:.04em;background:#100e0b}
td.n{white-space:nowrap}
.plan{display:block;width:100%;max-width:560px;background:#13110d;border:1px solid var(--line);margin:12px 0;direction:ltr}
.faq dt{font-weight:600;color:var(--ivory);margin-top:16px}.faq dd{margin:4px 0 0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px 28px}
.ph{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;list-style:none;padding:0;margin:8px 0}.ph figure{margin:0}.ph figcaption{font-size:12px;color:var(--muted)}
.facts li{margin:4px 0}
footer{margin-top:48px;border-top:1px solid var(--line);background:#100e0b;padding:24px 0 96px;font-size:15px}
footer nav{display:flex;flex-wrap:wrap;gap:0 6px}footer nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 6px;color:var(--text)}
.ctas{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}`;

function head(l, p) {
  const alts = LANGS.map(x => `<link rel="alternate" hreflang="${x}" href="${p.alt(x)}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${p.xdef}">`;
  const og = `${BASE}/assets/og/${p.og || 'home'}.jpg`;
  const v = CFG.verification || {};
  const verif = p.home ? [v.google && `<meta name="google-site-verification" content="${esc(v.google)}">`, v.bing && `<meta name="msvalidate.01" content="${esc(v.bing)}">`, v.yandex && `<meta name="yandex-verification" content="${esc(v.yandex)}">`].filter(Boolean).join('') : '';
  return `<!doctype html><html lang="${l}" dir="${S[l].dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title>`
    + `<meta name="description" content="${esc(p.desc)}"><link rel="canonical" href="${p.canonical}">${alts}`
    + `<meta name="robots" content="index,follow,max-image-preview:large"><meta name="theme-color" content="#0B0A08"><meta name="color-scheme" content="dark">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(l === 'uk' ? 'ЖК VILNYI' : 'VILNYI Uzhhorod')}"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.desc)}"><meta property="og:url" content="${p.canonical}"><meta property="og:image" content="${og}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(p.ogAlt || p.h1)}"><meta property="og:locale" content="${S[l].locale}">`
    + LANGS.filter(x => x !== l).map(x => `<meta property="og:locale:alternate" content="${S[x].locale}">`).join('')
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(p.title)}"><meta name="twitter:description" content="${esc(p.desc)}"><meta name="twitter:image" content="${og}">`
    + verif
    + `<link rel="icon" type="image/png" href="/assets/brand/group-apple-touch-icon.png"><link rel="apple-touch-icon" href="/assets/brand/group-apple-touch-icon.png"><link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">`
    + `<style>${CSS}</style><script type="application/ld+json">${JSON.stringify(p.ld).replace(/</g, '\\u003c')}</script></head>`;
}

const NAV = ['apartments', 'location', 'progress', 'parking', 'faq', 'contacts'];
const NAVKEY = { apartments: 'apartments/', location: 'location/', progress: 'construction/', parking: 'parking/', faq: 'faq/', contacts: 'contacts/' };
function shell(l, p, body) {
  const nav = NAV.map(k => `<a href="${rel(l, NAVKEY[k])}"${p.section === k ? ' aria-current="page"' : ''}>${esc(S[l].nav[k])}</a>`).join('');
  const langs = LANGS.map(x => `<a href="${p.altRel(x)}" hreflang="${x}" lang="${x}" title="${esc(S[x].langName)}"${x === l ? ' aria-current="true"' : ''}>${S[x].short}</a>`).join('');
  const crumbs = p.crumbs?.length ? `<nav class="bc w" aria-label="breadcrumb"><ol>${p.crumbs.map((c, i) => i < p.crumbs.length - 1 ? `<li><a href="${c[1]}">${esc(c[0])}</a></li>` : `<li aria-current="page">${esc(c[0])}</li>`).join('')}</ol></nav>` : '';
  const fl = [['home', ''], ['apartments', 'apartments/'], ...B_IDS.map(b => [b, `building-${BLD[b].no}/`]), ['location', 'location/'], ['progress', 'construction/'], ['parking', 'parking/'], ['faq', 'faq/'], ['contacts', 'contacts/'], ['facts', 'facts/']]
    .map(([k, key]) => `<a href="${rel(l, key)}">${esc(BLD[k] ? T(l, 'building', { n: BLD[k].no }) : S[l].nav[k])}</a>`).join('');
  return head(l, p) + `<body><a class="skip" href="#main">${esc(T(l, 'skip'))}</a>`
    + `<header><div class="w hd"><a class="logo" href="${rel(l)}"><img src="/assets/brand/vilnyi-logo-new.svg" alt="${esc(T(l, 'complex'))}" width="413" height="166"></a><nav class="m" aria-label="main">${nav}</nav>`
    + `<a class="cta" href="${appHref(l, '#finder')}">${esc(T(l, 'open3d'))}</a><div class="langs" aria-label="${esc(T(l, 'otherLangs'))}">${langs}</div></div></header>`
    + crumbs + `<main id="main" class="w">${body}</main>`
    + `<footer><div class="w"><p><strong>${esc(T(l, 'complex'))}</strong> · ${esc(st(l, 'loc.addressV'))} · ${esc(T(l, 'kDeveloper'))}: <a href="${C.site}" rel="noopener">VILNYI Group</a></p>`
    + `<p><a href="tel:${C.phone}">${phoneTxt(C.phone)}</a> · WhatsApp / Viber <a href="${waHref(l)}" rel="noopener">${phoneTxt(C.whatsapp)}</a> · <a href="mailto:${C.email}">${C.email}</a> · <a href="${C.instagram}" rel="noopener">Instagram @vilnyi.uzhhorod</a></p>`
    + `<nav aria-label="footer">${fl}<a href="/llms.txt">llms.txt</a></nav>`
    + `<p class="note">${esc(T(l, 'footNote'))} ${esc(T(l, 'srcNote'))} ${esc(T(l, 'updated', { d: '__LASTMOD_FMT__' }))}</p></div></footer></body></html>\n`;
}

// ---------------------------------------------------------------- JSON-LD
const ORG = { '@type': 'Organization', '@id': `${BASE}/#org`, name: 'VILNYI Group', url: C.site, logo: `${BASE}/assets/brand/group-apple-touch-icon.png`, email: C.email,
  contactPoint: [{ '@type': 'ContactPoint', telephone: C.phone, contactType: 'sales', areaServed: 'UA', availableLanguage: ['uk', 'en'] },
    { '@type': 'ContactPoint', telephone: C.whatsapp, contactType: 'sales', description: 'WhatsApp / Viber', areaServed: 'UA' }] };
function complexLd(l, full) {
  const addr = l === 'uk' ? { street: 'вул. Михайла Грушевського, 4А', city: 'Ужгород', region: 'Закарпатська область' } : { street: '4A Mykhaila Hrushevskoho St', city: 'Uzhhorod', region: 'Zakarpattia Oblast' };
  const o = { '@type': 'ApartmentComplex', '@id': `${BASE}/#complex`, name: 'ЖК VILNYI', alternateName: ['VILNYI', 'ЖК Вільний', 'VILNYI Uzhhorod'],
    url: url(l), description: st(l, 'hero.lead'),
    address: { '@type': 'PostalAddress', streetAddress: addr.street, addressLocality: addr.city, addressRegion: addr.region, addressCountry: 'UA' },
    geo: { '@type': 'GeoCoordinates', latitude: P.geo.lat, longitude: P.geo.lon },
    hasMap: `https://www.openstreetmap.org/?mlat=${P.geo.lat}&mlon=${P.geo.lon}#map=18/${P.geo.lat}/${P.geo.lon}`,
    numberOfAccommodationUnits: P.totals.apartments, image: `${BASE}/assets/og/home.jpg`, telephone: C.phone, sameAs: [C.instagram, C.facebook],
    tourBookingPage: `${BASE}${appHref(l, '#finder')}` };
  if (full) {
    o.containsPlace = B_IDS.map(b => ({ '@id': `${BASE}/#building-${BLD[b].no}` }));
    o.amenityFeature = [
      ['life.market.t'], ['life.playland.t'], ['life.spa.t'], ['life.parking.t'], ['life.shelter.t'], ['life.yard.t'],
    ].map(([k]) => ({ '@type': 'LocationFeatureSpecification', name: st(l, k), value: true }));
    o.additionalProperty = [
      { '@type': 'PropertyValue', name: st(l, 'facts.plot'), value: P.totals.plotHa, unitText: 'ha' },
      { '@type': 'PropertyValue', name: st(l, 'facts.ceiling'), value: P.facts.ceiling, unitCode: 'MTR' },
      { '@type': 'PropertyValue', name: st(l, 'facts.parking'), value: PARK.car },
      { '@type': 'PropertyValue', name: st(l, 'facts.ev'), value: PARK.ev },
    ];
  }
  return o;
}
function buildingLd(l, b) {
  const B = BLD[b];
  return { '@type': 'Residence', '@id': `${BASE}/#building-${B.no}`, name: `ЖК VILNYI — ${T(l, 'building', { n: B.no })}`, url: url(l, `building-${B.no}/`),
    containedInPlace: { '@id': `${BASE}/#complex` }, image: `${BASE}/assets/og/${OG[b]}.jpg`,
    additionalProperty: [
      { '@type': 'PropertyValue', name: T(l, 'floors'), value: B.floors },
      { '@type': 'PropertyValue', name: T(l, 'flats'), value: B.apartments },
      { '@type': 'PropertyValue', name: T(l, 'kDelivery'), value: qTxt(l, B.delivery) },
    ] };
}
function webPageLd(l, p, type = 'WebPage') {
  return { '@type': type, '@id': `${p.canonical}#webpage`, url: p.canonical, name: p.title, description: p.desc, inLanguage: l,
    isPartOf: { '@id': `${BASE}/#website` }, about: { '@id': `${BASE}/#complex` }, dateModified: '__LASTMOD__',
    primaryImageOfPage: { '@type': 'ImageObject', url: `${BASE}/assets/og/${p.og || 'home'}.jpg`, width: 1200, height: 630 },
    ...(p.crumbs?.length ? { breadcrumb: { '@id': `${p.canonical}#breadcrumb` } } : {}) };
}
function crumbLd(p) {
  return { '@type': 'BreadcrumbList', '@id': `${p.canonical}#breadcrumb`, itemListElement: p.crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: BASE + c[1] })) };
}
const WEBSITE = l => ({ '@type': 'WebSite', '@id': `${BASE}/#website`, url: `${BASE}/`, name: 'ЖК VILNYI', alternateName: 'VILNYI Uzhhorod', inLanguage: LANGS, publisher: { '@id': `${BASE}/#org` } });
function graph(l, p, nodes, type, full = false) {
  return { '@context': 'https://schema.org', '@graph': [ORG, WEBSITE(l), complexLd(l, full), webPageLd(l, p, type), ...(p.crumbs?.length ? [crumbLd(p)] : []), ...nodes] };
}
function priceSpecs(l) {
  return [{ '@type': 'UnitPriceSpecification', price: D.USD_PER_M2, priceCurrency: 'USD', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MTK' } },
    { '@type': 'UnitPriceSpecification', price: D.UAH_PER_M2, priceCurrency: 'UAH', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MTK' }, validFrom: RATE.date }];
}

// ---------------------------------------------------------------- shared numbers per language
function nums(l) {
  const from = r => uah(l, Math.min(...byRooms(r).map(u => u.price)));
  const ar = r => { const [a, b] = minmax(byRooms(r).map(u => u.area)); return T(l, 'areaRange', { a: area(l, a), b: area(l, b) }); };
  return {
    usd: D.USD_PER_M2, uah: uah(l, D.UAH_PER_M2), rate: rateTxt(l, RATE.rate), date: dateTxt(l, RATE.date),
    p1: from(1), p2: from(2), p3: from(3), a1: ar(1), a2: ar(2), a3: ar(3), from: from(1),
    n: P.totals.apartments, r1: P.totals.byRooms[1], r2: P.totals.byRooms[2], r3: P.totals.byRooms[3],
    q1: qTxt(l, BLD.B1.delivery), q2: qTxt(l, BLD.B2.delivery), q3: qTxt(l, BLD.B3.delivery), q4: qTxt(l, BLD.B4.delivery), sd: dateTxt(l, STATUS_DATE),
    ...PARK, addr: st(l, 'loc.addressV'), lat: P.geo.lat, lon: P.geo.lon, dev: P.developerInfo.name, years: P.developerInfo.years,
    customer: P.facts.customer.name, contractor: P.facts.contractor.name, permit: P.facts.permit.number, permitDate: dateTxt(l, P.facts.permit.date), cad: P.facts.cadastral.number,
    phone: phoneTxt(C.phone), wa: phoneTxt(C.whatsapp), email: C.email, office: st(l, 'foot.officeV'), hours: st(l, 'foot.hoursV'),
  };
}
const priceNote = l => `<p class="note">${esc(T(l, 'priceNote', nums(l)))}</p>`;
const ctas = (l, hash = '#finder') => `<div class="ctas"><a class="cta" href="${appHref(l, hash)}">${esc(T(l, 'open3d'))}</a><a class="cta o" href="${waHref(l)}" rel="noopener">${esc(T(l, 'writeWa'))}</a></div>`;
const statusTxt = (l, b) => (BLD[b].status === 'prep' ? T(l, 'statusPrep') : T(l, 'statusBuilding'));
const mixTxt = (l, units) => [1, 2, 3].map(r => [r, units.filter(u => u.rooms === r).length]).filter(x => x[1]).map(([r, n]) => `${n} × ${S[l].roomsShort[r]}`).join(', ');
const layoutTitle = (l, t) => `${S[l].roomsSg[t.rooms]} ${area(l, t.total)} ${M2(l)}`;

// ---------------------------------------------------------------- pages
const PAGES = [];   // {lang, key, html}
function addPage(l, key, p, body) {
  p.canonical = url(l, key); p.alt = x => url(x, key); p.altRel = x => rel(x, key); p.xdef = key === '' ? `${BASE}/` : url('uk', key); p.home = key === '';
  PAGES.push({ lang: l, key, html: shell(l, p, body) });
}
const crumb = (l, ...xs) => [[S[l].nav.home, rel(l)], ...xs];

function pageHome(l) {
  const N = nums(l), p = { title: T(l, 'homeTitle'), desc: T(l, 'homeDesc', N), h1: T(l, 'homeH1'), og: 'home', section: 'home', crumbs: [] };
  p.canonical = url(l); p.ld = graph(l, p, B_IDS.map(b => buildingLd(l, b)), 'WebPage', true);
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(st(l, 'hero.lead'))}</p>`;
  b += `<figure class="hero">${picture(l, IMGS.home, { eager: true, sizes: '(max-width: 1100px) 100vw, 1100px' })}</figure>`;
  b += `<dl class="kv"><div><dt>${esc(T(l, 'kAddress'))}</dt><dd>${esc(st(l, 'loc.addressV'))}</dd></div><div><dt>${esc(T(l, 'kDeveloper'))}</dt><dd>VILNYI Group</dd></div>`
    + `<div><dt>${esc(T(l, 'kApartments'))}</dt><dd>${N.n} (${esc(T(l, 'fMixV', N))})</dd></div><div><dt>${esc(T(l, 'kBuildings'))}</dt><dd>${esc(st(l, 'facts.buildingsV'))}</dd></div>`
    + `<div><dt>${esc(T(l, 'kPrice'))}</dt><dd>${D.USD_PER_M2} $ · ${esc(N.uah)}</dd></div><div><dt>${esc(T(l, 'kInstalment'))}</dt><dd>${esc(T(l, 'instalmentV'))}</dd></div>`
    + `<div><dt>${esc(T(l, 'kDelivery'))}</dt><dd>${B_IDS.map(x => `№${BLD[x].no} — ${esc(qTxt(l, BLD[x].delivery))}`).join('; ')}</dd></div>`
    + `<div><dt>${esc(T(l, 'kParking'))}</dt><dd>${PARK.std} + ${PARK.tandem} + ${PARK.moto} · ${PARK.ev} EV</dd></div></dl>`;
  b += ctas(l) + priceNote(l);
  b += `<h2>${esc(T(l, 'secRooms'))}</h2><ul class="cards">${[1, 2, 3].map(r => `<li><a class="t" href="${rel(l, `apartments/${r}-room/`)}">${esc(S[l].roomsPl[r])}</a><br>${esc(T(l, 'flatsCount', { n: byRooms(r).length }))} · ${esc(N['a' + r])}<br>${esc(T(l, 'priceFrom', { p: N['p' + r] }))}</li>`).join('')}</ul>`;
  b += `<h2>${esc(T(l, 'secBuildings'))}</h2><ul class="cards">${B_IDS.map(x => `<li><a class="t" href="${rel(l, `building-${BLD[x].no}/`)}">${esc(T(l, 'building', { n: BLD[x].no }))}</a><br>${esc(T(l, 'floors'))}: ${BLD[x].floors} · ${esc(T(l, 'flats'))}: ${BLD[x].apartments}<br>${esc(T(l, 'kDelivery'))}: ${esc(qTxt(l, BLD[x].delivery))}</li>`).join('')}</ul>`;
  b += `<h2>${esc(T(l, 'secLife'))}</h2><p>${esc(st(l, 'life.lead'))}</p><div class="grid2">${['market', 'playland', 'spa', 'parking', 'shelter', 'yard'].map(k => `<div><h3>${esc(st(l, `life.${k}.t`))}</h3><p>${esc(st(l, `life.${k}.d`))}</p></div>`).join('')}</div>`;
  b += `<h2>${esc(T(l, 'secTerms'))}</h2><p>${esc(st(l, 'terms.lead'))}</p><ul><li>${esc(st(l, 'terms.priceD', { usdM2: D.USD_PER_M2, rateDate: N.date }))}</li><li>${esc(st(l, 'terms.instD'))}</li><li>${esc(st(l, 'terms.discT'))}: ${esc(st(l, 'terms.discD'))}</li><li>${esc(st(l, 'terms.deliveryD'))}</li><li>${esc(st(l, 'terms.programs'))}</li></ul>` + guideLink(l);
  b += `<h2>${esc(T(l, 'secLocation'))}</h2><p>${esc(st(l, 'loc.lead'))}</p><ul>${[1, 2, 3, 4].map(i => `<li>${esc(st(l, `loc.pt${i}`))}</li>`).join('')}</ul><p><a href="${rel(l, 'location/')}">${esc(T(l, 'locGuideLink'))} →</a></p>`;
  b += `<h2>${esc(T(l, 'secFaq'))}</h2><dl class="faq">${S[l].faq.slice(0, 5).map(([q, a]) => `<dt>${esc(fill(q, N))}</dt><dd>${esc(fill(a, N))}</dd>`).join('')}</dl><p><a href="${rel(l, 'faq/')}">${esc(S[l].nav.faq)} →</a> · <a href="${rel(l, 'facts/')}">${esc(S[l].nav.facts)} →</a></p>`;
  addPage(l, '', p, b);
}

function pageApartments(l) {
  const N = nums(l), p = { title: T(l, 'aptsTitle'), desc: T(l, 'aptsDesc', { ...N, t: TYPES.length }), h1: T(l, 'aptsH1'), og: 'apartments', section: 'apartments', crumbs: crumb(l, [S[l].nav.apartments, rel(l, 'apartments/')]) };
  p.canonical = url(l, 'apartments/');
  const list = { '@type': 'ItemList', '@id': `${p.canonical}#list`, name: p.h1, numberOfItems: 3, itemListElement: [1, 2, 3].map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: S[l].roomsPl[r], url: url(l, `apartments/${r}-room/`) })) };
  p.ld = graph(l, p, [list], 'CollectionPage');
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(T(l, 'aptsLead', { n: N.n, t: TYPES.length }))}</p>`;
  b += `<figure class="hero">${picture(l, IMGS.apartments, { eager: true, sizes: '(max-width: 1100px) 100vw, 1100px' })}</figure>`;
  for (const r of [1, 2, 3]) {
    const ts = TYPES.filter(t => t.rooms === r);
    b += `<h2><a href="${rel(l, `apartments/${r}-room/`)}">${esc(S[l].roomsPl[r])}</a></h2><p>${esc(T(l, 'roomsLead', { n: byRooms(r).length, t: ts.length, a: N['a' + r], p: N['p' + r] }))}</p>`;
    b += layoutTable(l, ts);
  }
  b += ctas(l) + priceNote(l) + `<p class="note">${esc(T(l, 'plansNote'))}</p>`;
  addPage(l, 'apartments/', p, b);
}
function layoutTable(l, ts) {
  return `<div class="tw"><table><thead><tr><th>${esc(T(l, 'layout'))}</th><th>${esc(T(l, 'area'))}</th><th>${esc(T(l, 'rooms'))}</th><th>${esc(T(l, 'building', { n: '' }).trim())}</th><th>${esc(T(l, 'floors'))}</th><th>${esc(T(l, 'flats'))}</th><th>${esc(T(l, 'price'))}</th></tr></thead><tbody>`
    + ts.map(t => { const us = unitsOf(t.key); return `<tr><td><a href="${rel(l, `layout/${slug(t.key)}/`)}">${t.key}</a></td><td class="n">${area(l, t.total)} ${M2(l)}</td><td>${t.rooms}</td><td>${BLD[t.building].no}</td><td>${ranges(us.map(u => u.floor))}</td><td>${us.length}</td><td class="n">${esc(uah(l, us[0].price))}</td></tr>`; }).join('')
    + '</tbody></table></div>';
}

function pageRooms(l, r) {
  const N = nums(l), ts = TYPES.filter(t => t.rooms === r), key = `apartments/${r}-room/`;
  const v = { pl: S[l].roomsPl[r], n: byRooms(r).length, t: ts.length, a: N['a' + r], p: N['p' + r], usd: D.USD_PER_M2 };
  const p = { title: T(l, 'roomsTitle', v), desc: T(l, 'roomsDesc', v), h1: S[l].roomsPl[r] + ' — ' + T(l, 'complex'), og: 'apartments', section: 'apartments', crumbs: crumb(l, [S[l].nav.apartments, rel(l, 'apartments/')], [S[l].roomsPl[r], rel(l, key)]) };
  p.canonical = url(l, key);
  const prices = byRooms(r).map(u => u.price);
  const agg = { '@type': 'AggregateOffer', '@id': `${p.canonical}#offers`, name: p.h1, priceCurrency: 'UAH', lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length, seller: { '@id': `${BASE}/#org` }, priceSpecification: priceSpecs(l),
    itemOffered: { '@type': 'Apartment', name: S[l].roomsPl[r], numberOfRooms: r, floorSize: { '@type': 'QuantitativeValue', minValue: Math.min(...byRooms(r).map(u => u.area)), maxValue: Math.max(...byRooms(r).map(u => u.area)), unitCode: 'MTK', unitText: 'm²' }, containedInPlace: { '@id': `${BASE}/#complex` } } };
  const list = { '@type': 'ItemList', '@id': `${p.canonical}#list`, numberOfItems: ts.length, itemListElement: ts.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: `${t.key} — ${area(l, t.total)} ${M2(l)}`, url: url(l, `layout/${slug(t.key)}/`) })) };
  p.ld = graph(l, p, [agg, list], 'CollectionPage');
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(T(l, 'roomsLead', v))}</p>`;
  for (const bId of B_IDS) {
    const tb = ts.filter(t => t.building === bId); if (!tb.length) continue;
    b += `<h2><a href="${rel(l, `building-${BLD[bId].no}/`)}">${esc(T(l, 'building', { n: BLD[bId].no }))}</a></h2>` + layoutTable(l, tb);
  }
  b += ctas(l) + priceNote(l) + `<p class="note">${esc(T(l, 'plansNote'))}</p>`;
  b += `<h2>${esc(T(l, 'seeAlso'))}</h2><ul>${[1, 2, 3].filter(x => x !== r).map(x => `<li><a href="${rel(l, `apartments/${x}-room/`)}">${esc(S[l].roomsPl[x])}</a></li>`).join('')}<li><a href="${rel(l, 'parking/')}">${esc(S[l].nav.parking)}</a></li><li><a href="${rel(l, 'faq/')}">${esc(S[l].nav.faq)}</a></li></ul>`;
  addPage(l, key, p, b);
}

function pageLayout(l, t) {
  const N = nums(l), us = unitsOf(t.key), u0 = us[0], B = BLD[t.building], key = `layout/${slug(t.key)}/`;
  const floors = ranges(us.map(u => u.floor));
  const roomsTxt = t.list.map(r => `${roomName(l, r).toLowerCase()} ${area(l, r.area)} ${M2(l)}`).join(', ');
  const prices = [...new Set(us.map(u => u.price))];
  const v = { sg: S[l].roomsSg[t.rooms], area: area(l, t.total), key: t.key, b: B.no, floors, n: us.length, roomsTxt, price: uah(l, u0.price), usdTotal: nf(l).format(u0.usd), facing: facingTxt(l, u0) };
  const p = { title: T(l, 'layoutTitle', v), desc: T(l, 'layoutDesc', v), h1: T(l, 'layoutH1', v), og: OG[t.building], section: 'apartments',
    crumbs: crumb(l, [S[l].nav.apartments, rel(l, 'apartments/')], [S[l].roomsPl[t.rooms], rel(l, `apartments/${t.rooms}-room/`)], [t.key, rel(l, key)]) };
  p.canonical = url(l, key);
  const baths = t.list.filter(r => r.kind === 'bath').length;
  const fsz = { '@type': 'QuantitativeValue', value: t.total, unitCode: 'MTK', unitText: 'm²' };
  const apt = { '@type': 'Apartment', '@id': `${p.canonical}#apartment`, name: p.h1, description: p.desc, floorSize: fsz, numberOfRooms: t.rooms, ...(baths ? { numberOfBathroomsTotal: baths } : {}),
    containedInPlace: { '@id': `${BASE}/#building-${B.no}` }, image: `${BASE}/assets/og/${OG[t.building]}.jpg`,
    accommodationFloorPlan: { '@type': 'FloorPlan', name: t.key, floorSize: fsz, numberOfRooms: t.rooms, ...(baths ? { numberOfBathroomsTotal: baths } : {}), layoutImage: `${BASE}/${D.PLATES[t.building].find(x => x.id === t.plate)?.image?.src || 'assets/og/home.jpg'}` },
    additionalProperty: [{ '@type': 'PropertyValue', name: T(l, 'floors'), value: floors }, { '@type': 'PropertyValue', name: T(l, 'flats'), value: us.length }] };
  const offer = prices.length === 1
    ? { '@type': 'Offer', '@id': `${p.canonical}#offer`, itemOffered: { '@id': apt['@id'] }, price: u0.price, priceCurrency: 'UAH', priceSpecification: priceSpecs(l), seller: { '@id': `${BASE}/#org` }, validFrom: RATE.date, description: T(l, 'priceNote', N) }
    : { '@type': 'AggregateOffer', '@id': `${p.canonical}#offer`, itemOffered: { '@id': apt['@id'] }, lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: us.length, priceCurrency: 'UAH', priceSpecification: priceSpecs(l), seller: { '@id': `${BASE}/#org` }, description: T(l, 'priceNote', N) };
  p.ld = graph(l, p, [buildingLd(l, t.building), apt, offer]);
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(T(l, 'layoutLead', v))}</p>`;
  b += `<dl class="kv"><div><dt>${esc(ui(l, 'unit.total'))}</dt><dd>${area(l, t.total)} ${M2(l)}</dd></div>`
    + (t.living ? `<div><dt>${esc(ui(l, 'unit.living'))}</dt><dd>${area(l, t.living)} ${M2(l)}</dd></div>` : '')
    + (t.outdoor ? `<div><dt>${esc(ui(l, 'unit.outdoor'))}</dt><dd>${area(l, t.outdoor)} ${M2(l)}</dd></div>` : '')
    + `<div><dt>${esc(T(l, 'price'))}</dt><dd>${esc(uah(l, u0.price))} <span class="muted">(${esc(usd(l, u0.usd))})</span></dd></div>`
    + `<div><dt>${esc(T(l, 'kDelivery'))}</dt><dd>${esc(qTxt(l, B.delivery))}</dd></div><div><dt>${esc(T(l, 'facing'))}</dt><dd>${esc(facingTxt(l, u0))}</dd></div></dl>`;
  b += planSvg(l, t.key);
  b += `<h2>${esc(T(l, 'roomsList'))}</h2><div class="tw"><table><tbody>${t.list.map(r => `<tr><td>${esc(roomName(l, r))}</td><td class="n">${area(l, r.area)} ${M2(l)}</td></tr>`).join('')}<tr><th>${esc(ui(l, 'unit.total'))}</th><th class="n">${area(l, t.total)} ${M2(l)}</th></tr></tbody></table></div>`;
  b += `<h2>${esc(T(l, 'tableFlats'))}</h2><div class="tw"><table><thead><tr><th>${esc(T(l, 'floor'))}</th><th>№</th><th>${esc(T(l, 'price'))}</th><th></th></tr></thead><tbody>`
    + us.map(u => `<tr><td>${u.floor}</td><td>${u.apNo}</td><td class="n">${esc(uah(l, u.price))}</td><td><a href="${appHref(l, `#u=${u.id}`)}">${esc(T(l, 'openFlat3d'))}</a></td></tr>`).join('') + '</tbody></table></div>';
  b += `<p class="note">${esc(ui(l, 'unit.numNote'))}. ${esc(T(l, 'plansNote'))}</p>` + ctas(l, `#u=${u0.id}`) + priceNote(l);
  const sib = TYPES.filter(x => x.building === t.building && x.key !== t.key && x.rooms === t.rooms).slice(0, 8);
  b += `<h2>${esc(T(l, 'seeAlso'))}</h2><ul><li><a href="${rel(l, `building-${B.no}/`)}">${esc(T(l, 'building', { n: B.no }))}</a></li><li><a href="${rel(l, `apartments/${t.rooms}-room/`)}">${esc(S[l].roomsPl[t.rooms])}</a></li>${sib.map(x => `<li><a href="${rel(l, `layout/${slug(x.key)}/`)}">${esc(layoutTitle(l, x))} — ${x.key}</a></li>`).join('')}</ul>`;
  addPage(l, key, p, b);
}

function pageBuilding(l, bId) {
  const N = nums(l), B = BLD[bId], key = `building-${B.no}/`, us = D.UNITS.filter(u => u.building === bId);
  const v = { b: B.no, floors: B.floors, n: us.length, mix: mixTxt(l, us), q: qTxt(l, B.delivery), status: statusTxt(l, bId), statusDate: dateTxt(l, B.statusDate) };
  const p = { title: T(l, 'buildingTitle', v), desc: T(l, 'buildingDesc', v), h1: T(l, 'buildingH1', v), og: OG[bId], section: 'apartments', crumbs: crumb(l, [T(l, 'building', { n: B.no }), rel(l, key)]) };
  p.canonical = url(l, key); p.ld = graph(l, p, [buildingLd(l, bId)]);
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(T(l, 'buildingLead', v))}</p><figure class="hero">${picture(l, IMGS[bId], { eager: true, sizes: '(max-width: 1100px) 100vw, 1100px' })}</figure>`;
  if (bId === 'B2') b += `<p>${esc(T(l, 'b2note'))}</p>`;
  if (bId === 'B3') b += `<p>${esc(T(l, 'b3note'))}</p>`;
  const ts = TYPES.filter(t => t.building === bId);
  b += `<h2>${esc(T(l, 'layouts'))}: ${ts.length}</h2>` + layoutTable(l, ts);
  b += `<h2>${esc(T(l, 'floorsTable'))}</h2><div class="tw"><table><thead><tr><th>${esc(T(l, 'floor'))}</th><th>${esc(T(l, 'flats'))}</th></tr></thead><tbody>`;
  for (const f of [...new Set(us.map(u => u.floor))].sort((a, c) => c - a)) {
    const fl = us.filter(u => u.floor === f).sort((a, c) => a.apNo - c.apNo);
    b += `<tr><td><a href="${appHref(l, `#b=${bId}&f=${f}`)}">${f}</a></td><td>${fl.map(u => `<a href="${rel(l, `layout/${slug(u.type)}/`)}">${esc(T(l, 'flatNo', { n: u.apNo }))}</a> ${esc(S[l].roomsShort[u.rooms])} ${area(l, u.area)} ${M2(l)} · ${esc(uah(l, u.price))}`).join('<br>')}</td></tr>`;
  }
  b += '</tbody></table></div>' + `<p class="note">${esc(ui(l, 'unit.numNote'))}.</p>` + ctas(l, `#b=${bId}&f=${B.typical ? (D.typicalPlate(bId)?.floors?.[0] ?? 1) : 1}`) + priceNote(l);
  b += `<h2>${esc(T(l, 'seeAlso'))}</h2><ul>${B_IDS.filter(x => x !== bId).map(x => `<li><a href="${rel(l, `building-${BLD[x].no}/`)}">${esc(T(l, 'building', { n: BLD[x].no }))}</a></li>`).join('')}<li><a href="${rel(l, 'construction/')}">${esc(S[l].nav.progress)}</a></li></ul>`;
  addPage(l, key, p, b);
}

// distances: great-circle (straight-line) metres from the plot centre (P.geo = data/pois.json → project); walking ≈ 80 m/min
const R_EARTH = 6371008.8, rad = d => d * Math.PI / 180;
const distM = ll => { const [la, lo] = ll, dLa = rad(la - P.geo.lat), dLo = rad(lo - P.geo.lon); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(P.geo.lat)) * Math.cos(rad(la)) * Math.sin(dLo / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.sqrt(h)); };
const NEAR = POIS.map(x => ({ ...x, d: x.distanceM === 0 ? 0 : Math.round(distM(x.ll)) })).sort((a, c) => a.d - c.d);
const poiName = (l, x) => x.name[l === 'uk' ? 'uk' : 'en'];
const distTxt = (l, x) => x.d === 0 ? T(l, 'onSite') : (x.approx ? '≈ ' : '') + (x.d >= 1000 ? `${nf(l, 1).format(x.d / 1000)} ${S[l].kmU}` : `${Math.max(10, Math.round(x.d / 10) * 10)} ${S[l].mU}`);
const walkTxt = (l, x) => x.d === 0 || x.d > 2500 ? '—' : T(l, 'walkMin', { n: Math.max(1, Math.ceil(x.d / 80)) });
const nearTxt = (l, x) => x ? `${distTxt(l, x)} (${walkTxt(l, x)})` : '—';
const LOC_GROUPS = [['transport', x => x.category === 'transport'], ['kinder', x => x.kind === 'kinder'], ['school', x => x.kind === 'highschool' || x.kind === 'university'], ['health', x => x.category === 'health'], ['shopping', x => x.category === 'shopping'], ['parks', x => x.category === 'parks'], ['leisure', x => x.category === 'leisure'], ['city', x => x.category === 'city']];
function pageLocation(l) {
  const p = { title: T(l, 'locTitle'), desc: T(l, 'locDesc'), h1: T(l, 'locH1'), og: 'location', section: 'location', crumbs: crumb(l, [S[l].nav.location, rel(l, 'location/')]) };
  p.canonical = url(l, 'location/');
  const off = NEAR.filter(x => x.d > 0);
  const first = f => off.find(f);
  const ans = T(l, 'locAnswer', { addr: st(l, 'loc.addressV'), stop: nearTxt(l, first(x => x.kind === 'bus')), kg: nearTxt(l, first(x => x.kind === 'kinder')), school: nearTxt(l, first(x => x.kind === 'highschool')), shop: nearTxt(l, first(x => x.kind === 'supermarket')), centre: nearTxt(l, first(x => x.id === 'narodna')) });
  const list = { '@type': 'ItemList', '@id': `${p.canonical}#nearby`, name: T(l, 'hNear'), description: T(l, 'distNote'), numberOfItems: off.length, itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: off.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: poiName(l, x),
      item: { '@type': 'Place', name: poiName(l, x), geo: { '@type': 'GeoCoordinates', latitude: x.ll[0], longitude: x.ll[1] }, additionalProperty: [{ '@type': 'PropertyValue', name: T(l, 'thDist'), value: x.d, unitCode: 'MTR' }] } })) };
  p.ld = graph(l, p, [list, ...B_IDS.map(x => buildingLd(l, x))], 'WebPage', true);
  const osm = `https://www.openstreetmap.org/?mlat=${P.geo.lat}&mlon=${P.geo.lon}#map=17/${P.geo.lat}/${P.geo.lon}`;
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(ans)}</p><p>${esc(st(l, 'loc.lead'))}</p><figure class="hero">${picture(l, IMGS.location, { eager: true, sizes: '(max-width: 1100px) 100vw, 1100px' })}</figure>`;
  b += `<dl class="kv"><div><dt>${esc(T(l, 'kAddress'))}</dt><dd>${esc(st(l, 'loc.addressV'))}</dd></div><div><dt>${esc(T(l, 'fDistrict'))}</dt><dd>${esc(st(l, 'loc.title'))}</dd></div><div><dt>${esc(T(l, 'coords'))}</dt><dd>${P.geo.lat}, ${P.geo.lon} · <a href="${osm}" rel="noopener">OpenStreetMap</a></dd></div></dl>`;
  b += `<ul>${[1, 2, 3, 4].map(i => `<li>${esc(st(l, `loc.pt${i}`))}</li>`).join('')}</ul>`;
  b += `<h2>${esc(T(l, 'hNear'))}</h2><p class="note">${esc(T(l, 'distNote'))} ${esc(T(l, 'walkNote'))}</p>`;
  for (const [g, f] of LOC_GROUPS) {
    const xs = NEAR.filter(f); if (!xs.length) continue;
    b += `<h3>${esc(S[l].cat[g])}</h3><div class="tw"><table><thead><tr><th>${esc(T(l, 'thPlace'))}</th><th>${esc(T(l, 'thDist'))}</th><th>${esc(T(l, 'thWalk'))}</th></tr></thead><tbody>${xs.map(x => `<tr><td>${esc(poiName(l, x))}</td><td class="n">${esc(distTxt(l, x))}</td><td class="n">${esc(walkTxt(l, x))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  b += `<p class="note">© OpenStreetMap contributors.</p>` + ctas(l, '#location');
  b += `<h2>${esc(T(l, 'seeAlso'))}</h2><ul>${[['faq/', S[l].nav.faq], ['guide/', S[l].guide.link], ['apartments/', S[l].nav.apartments], ['construction/', S[l].nav.progress], ['contacts/', S[l].nav.contacts]].map(([k, t]) => `<li><a href="${rel(l, k)}">${esc(t)}</a></li>`).join('')}</ul>`;
  addPage(l, 'location/', p, b);
}

// one-sentence answer to «when will the buildings be completed» — grouped by quarter from the same BLD data as the table
function deliveryAnswer(l) {
  const groups = [];
  for (const x of [...B_IDS].sort((a, c) => (BLD[a].delivery.year - BLD[c].delivery.year) || (BLD[a].delivery.q - BLD[c].delivery.q) || (BLD[a].no - BLD[c].no))) {
    const q = qTxt(l, BLD[x].delivery), g = groups.find(e => e.q === q);
    if (g) g.ns.push(BLD[x].no); else groups.push({ q, ns: [BLD[x].no] });
  }
  const and = T(l, 'progAnsAnd'), no = n => T(l, 'progAnsNo', { n });
  const list = groups.map(g => g.ns.length === 1 ? T(l, 'progAnsOne', { n: g.ns[0], q: g.q })
    : T(l, 'progAnsMany', { n: g.ns.slice(0, -1).map(no).join(', ') + and + no(g.ns[g.ns.length - 1]), q: g.q }));
  return T(l, 'progAns', { list: list.join(', ') });
}

function pageProgress(l) {
  const tl = [...D.PROGRESS.timeline].sort((a, c) => c.date.localeCompare(a.date));
  const photos = tl.reduce((m, e) => m + e.photos.length, 0);
  const v = { m: tl.length, p: photos, first: monthTxt(l, tl[tl.length - 1].date), last: monthTxt(l, tl[0].date) };
  const p = { title: T(l, 'progTitle'), desc: T(l, 'progDesc', v), h1: T(l, 'progH1'), og: 'progress', section: 'progress', crumbs: crumb(l, [S[l].nav.progress, rel(l, 'construction/')]) };
  p.canonical = url(l, 'construction/');
  const latest = tl[0].photos.filter(x => x.local).map(x => ({ '@type': 'ImageObject', contentUrl: `${BASE}/${x.local}`, thumbnailUrl: x.thumb ? `${BASE}/${x.thumb}` : undefined, caption: `${T(l, 'building', { n: x.building.slice(1) })} — ${monthTxt(l, tl[0].date)}`, creditText: x.credit, uploadDate: tl[0].date }));
  p.ld = graph(l, p, [{ '@type': 'ImageGallery', '@id': `${p.canonical}#latest`, name: `${p.h1} — ${v.last}`, image: latest }], 'CollectionPage');
  let b = `<h1>${esc(p.h1)}</h1><p class="lead"><strong>${esc(deliveryAnswer(l))}</strong> ${esc(T(l, 'progAnsNote', { sd: dateTxt(l, STATUS_DATE) }))}</p><p>${esc(T(l, 'progLead', v))}</p>`;
  b += `<div class="tw"><table><thead><tr><th>${esc(T(l, 'building', { n: '' }).trim())}</th><th>${esc(T(l, 'floors'))}</th><th>${esc(T(l, 'status'))}</th><th>${esc(T(l, 'kDelivery'))}</th></tr></thead><tbody>${B_IDS.map(x => `<tr><td><a href="${rel(l, `building-${BLD[x].no}/`)}">${BLD[x].no}</a></td><td>${BLD[x].floors}</td><td>${esc(statusTxt(l, x))} (${esc(T(l, 'statusOn', { d: dateTxt(l, BLD[x].statusDate) }))})</td><td>${esc(qTxt(l, BLD[x].delivery))}</td></tr>`).join('')}</tbody></table></div>`;
  const fig = (e, x) => `<li><figure><a href="/${x.local}"><img src="/${x.thumb || x.local}" width="360" height="240" alt="${esc(`${T(l, 'building', { n: x.building.slice(1) })} — ${monthTxt(l, e.date)}`)}" loading="lazy" decoding="async"></a><figcaption>${esc(T(l, 'building', { n: x.building.slice(1) }))} · ${esc(T(l, 'photoCredit', { c: x.credit }))}</figcaption></figure></li>`;
  for (const e of tl.slice(0, 4)) b += `<h2>${esc(monthTxt(l, e.date))}</h2><p class="muted">${esc(dateTxt(l, e.date))} · ${esc(T(l, 'photosN', { n: e.photos.length }))}</p><ul class="ph">${e.photos.filter(x => x.local).map(x => fig(e, x)).join('')}</ul>`;
  b += `<h2>${esc(T(l, 'olderMonths'))}</h2><ul>${tl.slice(4).map(e => `<li>${esc(monthTxt(l, e.date))} — ${esc(T(l, 'photosN', { n: e.photos.length }))}: ${e.photos.filter(x => x.local).map((x, i) => `<a href="/${x.local}">${esc(T(l, 'building', { n: x.building.slice(1) }))} ${i + 1}</a>`).join(', ')}</li>`).join('')}</ul>`;
  b += `<p class="note">${esc(T(l, 'photoCredit', { c: 'LUN (lun.ua) / VILNYI Group' }))}</p>` + ctas(l, '#progress');
  addPage(l, 'construction/', p, b);
}

function pageParking(l) {
  const v = { car: PARK.car, moto: PARK.moto, ev: PARK.ev };
  const p = { title: T(l, 'parkTitle'), desc: T(l, 'parkDesc', v), h1: T(l, 'parkH1'), og: 'parking', section: 'parking', crumbs: crumb(l, [S[l].nav.parking, rel(l, 'parking/')]) };
  p.canonical = url(l, 'parking/');
  const pk = { '@type': 'ParkingFacility', '@id': `${BASE}/#parking`, name: p.h1, containedInPlace: { '@id': `${BASE}/#complex` }, geo: { '@type': 'GeoCoordinates', latitude: P.geo.lat, longitude: P.geo.lon },
    amenityFeature: [{ '@type': 'LocationFeatureSpecification', name: S[l].parkFacts.ev, value: PARK.ev }, { '@type': 'LocationFeatureSpecification', name: S[l].parkFacts.shelter, value: true }],
    additionalProperty: Object.entries({ car: PARK.car, std: PARK.std, tandem: PARK.tandem, moto: PARK.moto, ramps: PARK.ramps }).map(([k, x]) => ({ '@type': 'PropertyValue', name: S[l].parkFacts[k], value: x })) };
  p.ld = graph(l, p, [pk]);
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(st(l, 'life.parking.d'))}</p><figure class="hero">${picture(l, IMGS.parking, { eager: true, sizes: '(max-width: 1100px) 100vw, 1100px' })}</figure>`;
  b += `<dl class="kv">${['car', 'std', 'tandem', 'moto', 'ev', 'ramps'].map(k => `<div><dt>${esc(S[l].parkFacts[k])}</dt><dd>${PARK[k]}</dd></div>`).join('')}<div><dt>${esc(S[l].parkFacts.shelter)}</dt><dd>${esc(T(l, 'shelterV'))}</dd></div></dl>`;
  b += `<p>${esc(st(l, 'life.shelter.d'))}</p><p><strong>${esc(T(l, 'parkPrice'))}</strong></p>` + ctas(l, '#finder');
  b += `<h2>${esc(T(l, 'seeAlso'))}</h2><ul><li><a href="${rel(l, 'apartments/')}">${esc(S[l].nav.apartments)}</a></li><li><a href="${rel(l, 'faq/')}">${esc(S[l].nav.faq)}</a></li></ul>`;
  addPage(l, 'parking/', p, b);
}

function pageFaq(l) {
  const N = nums(l), p = { title: T(l, 'faqTitle'), desc: T(l, 'faqDesc'), h1: T(l, 'faqH1'), og: 'home', section: 'faq', crumbs: crumb(l, [S[l].nav.faq, rel(l, 'faq/')]) };
  p.canonical = url(l, 'faq/');
  const qa = S[l].faq.map(([q, a]) => [fill(q, N), fill(a, N)]);
  p.ld = graph(l, p, [], 'FAQPage');
  const wp = p.ld['@graph'].find(n => n['@type'] === 'FAQPage');
  wp.mainEntity = qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }));
  let b = `<h1>${esc(p.h1)}</h1>` + guideLink(l) + `<p><a href="${rel(l, 'location/')}">${esc(T(l, 'locGuideLink'))} →</a></p><dl class="faq">${qa.map(([q, a], i) => `<dt>${esc(q)}</dt><dd>${esc(a)}${S[l].faq[i][1].includes('{q1}') ? ` <a href="${rel(l, 'construction/')}">${esc(S[l].nav.progress)} →</a>` : ''}</dd>`).join('')}</dl>` + ctas(l) + priceNote(l);
  addPage(l, 'faq/', p, b);
}

function pageContacts(l) {
  const N = nums(l), p = { title: T(l, 'contTitle'), desc: T(l, 'contDesc', N), h1: T(l, 'contH1'), og: 'home', section: 'contacts', crumbs: crumb(l, [S[l].nav.contacts, rel(l, 'contacts/')]) };
  p.canonical = url(l, 'contacts/');
  p.ld = graph(l, p, [{ '@type': 'LocalBusiness', '@id': `${BASE}/#sales-office`, name: `ЖК VILNYI — ${T(l, 'kOffice')}`, parentOrganization: { '@id': `${BASE}/#org` }, telephone: C.phone, email: C.email, url: url(l, 'contacts/'),
    address: { '@type': 'PostalAddress', streetAddress: l === 'uk' ? 'вул. Грушевського, 23' : '23 Hrushevskoho St', addressLocality: l === 'uk' ? 'Ужгород' : 'Uzhhorod', addressCountry: 'UA' },
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '10:00', closes: '18:00' }, { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: '11:00', closes: '15:00' }],
    sameAs: [C.instagram, C.facebook] }], 'ContactPage');
  const row = (k, vv) => `<div><dt>${esc(k)}</dt><dd>${vv}</dd></div>`;
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(st(l, 'foot.contactNote'))}</p><dl class="kv">`
    + row(T(l, 'kPhone'), `<a href="tel:${C.phone}">${phoneTxt(C.phone)}</a>`) + row('WhatsApp', `<a href="${waHref(l)}" rel="noopener">${phoneTxt(C.whatsapp)}</a>`)
    + row('Viber', `<a href="viber://chat?number=%2B${C.viber.replace(/\D/g, '')}">${phoneTxt(C.viber)}</a>`) + row(T(l, 'kEmail'), `<a href="mailto:${C.email}">${C.email}</a>`)
    + row(T(l, 'kOffice'), esc(st(l, 'foot.officeV'))) + row(T(l, 'kHours'), esc(st(l, 'foot.hoursV')))
    + row('Instagram', `<a href="${C.instagram}" rel="noopener">@vilnyi.uzhhorod</a>`) + row('Facebook', `<a href="${C.facebook}" rel="noopener">VILNYI</a>`)
    + row(T(l, 'kSite'), `<a href="${C.site}" rel="noopener">vilnyi.group</a>`) + '</dl>' + ctas(l);
  addPage(l, 'contacts/', p, b);
}

function factRows(l) {
  const N = nums(l);
  return [
    [T(l, 'fName'), 'ЖК VILNYI (VILNYI, «Вільний»)'], [T(l, 'fType'), T(l, 'fTypeV')], [T(l, 'kAddress'), st(l, 'loc.addressV')],
    [T(l, 'fDistrict'), st(l, 'loc.title')], [T(l, 'fCoords'), `${P.geo.lat}, ${P.geo.lon}`], [T(l, 'kDeveloper'), `VILNYI Group (${C.site})`],
    [st(l, 'facts.customer'), P.facts.customer.name + ' — ' + st(l, 'facts.perListing')], [st(l, 'facts.contractor'), P.facts.contractor.name + ' — ' + st(l, 'facts.perListing')],
    [st(l, 'facts.permit'), st(l, 'facts.permitV', { n: P.facts.permit.number, d: dateTxt(l, P.facts.permit.date) })], [st(l, 'facts.cadastral'), P.facts.cadastral.number],
    [T(l, 'kBuildings'), st(l, 'facts.buildingsV')], [T(l, 'kApartments'), String(N.n)], [T(l, 'fMix'), T(l, 'fMixV', N)],
    [T(l, 'fAreas'), `${S[l].roomsShort[1]} ${N.a1}; ${S[l].roomsShort[2]} ${N.a2}; ${S[l].roomsShort[3]} ${N.a3}`],
    [T(l, 'fPrice'), T(l, 'fPriceV', N)], [T(l, 'fFrom'), `${S[l].roomsShort[1]} ${N.p1}; ${S[l].roomsShort[2]} ${N.p2}; ${S[l].roomsShort[3]} ${N.p3}`],
    [T(l, 'fPay'), T(l, 'fPayV')], [T(l, 'fDisc'), T(l, 'fDiscV')], [T(l, 'fPrograms'), T(l, 'fProgramsV')],
    [T(l, 'fDelivery'), `№2 — ${N.q2}; №1 — ${N.q1}; №3 — ${N.q3}; №4 — ${N.q4} (${ui(l, 'delivery.tbc')})`],
    [T(l, 'fStatus'), `№1–3 — ${T(l, 'statusBuilding')}, №4 — ${T(l, 'statusPrep')} (${N.sd})`],
    [st(l, 'facts.tech'), st(l, 'facts.techV')], [st(l, 'facts.walls'), st(l, 'facts.wallsV')], [st(l, 'facts.insulation'), st(l, 'facts.insulationV')],
    [st(l, 'facts.heating'), st(l, 'facts.heatingV')], [st(l, 'facts.ceiling'), st(l, 'facts.ceilingV')], [st(l, 'facts.power'), st(l, 'facts.powerV')],
    [st(l, 'facts.shelter'), st(l, 'facts.shelterV')], [T(l, 'fFinish'), T(l, 'fFinishV')], [st(l, 'facts.plot'), st(l, 'facts.plotV')],
    [st(l, 'facts.parking'), st(l, 'facts.parkingV', { n: PARK.std, t: PARK.tandem, m: PARK.moto })], [st(l, 'facts.ev'), st(l, 'facts.evV', { n: PARK.ev })],
    [st(l, 'life.market.t'), st(l, 'life.market.d')], [st(l, 'life.spa.t'), st(l, 'life.spa.d')],
    [T(l, 'kPhone'), phoneTxt(C.phone)], [T(l, 'fWa'), phoneTxt(C.whatsapp)], [T(l, 'kEmail'), C.email], ['Instagram', 'vilnyi.uzhhorod — ' + C.instagram],
    [T(l, 'kOffice'), `${st(l, 'foot.officeV')}; ${st(l, 'foot.hoursV')}`], [T(l, 'fSite'), `${BASE}/`],
  ];
}
function pageFacts(l) {
  const p = { title: T(l, 'factsTitle'), desc: T(l, 'factsDesc'), h1: T(l, 'factsH1'), og: 'home', section: 'facts', crumbs: crumb(l, [S[l].nav.facts, rel(l, 'facts/')]) };
  p.canonical = url(l, 'facts/'); p.ld = graph(l, p, B_IDS.map(b => buildingLd(l, b)), 'AboutPage', true);
  let b = `<h1>${esc(p.h1)}</h1><p class="muted">${esc(T(l, 'factsLead', { date: '__LASTMOD_FMT__' }))}</p><ul class="facts">${factRows(l).map(([k, vv]) => `<li><strong>${esc(k)}:</strong> ${esc(vv)}</li>`).join('')}</ul>`;
  b += guideLink(l) + `<p class="note">${esc(st(l, 'facts.disclaimer'))}</p>`;
  addPage(l, 'facts/', p, b);
}

// <lang>/guide/ — how to buy: price, payment, discounts, єОселя, documents, dates, steps (only facts already on the site)
function pageGuide(l) {
  const N = nums(l), G = S[l].guide, key = 'guide/';
  const p = { title: G.title, desc: fill(G.desc, N), h1: G.h1, og: 'home', section: 'guide', crumbs: crumb(l, [G.nav, rel(l, key)]) };
  p.canonical = url(l, key); p.ld = graph(l, p, []);
  const more = (k, txt) => `<p><a href="${rel(l, k)}">${esc(txt)} →</a></p>`;
  const row = (k, vv) => `<div><dt>${esc(k)}</dt><dd>${vv}</dd></div>`;
  const stepLinks = [`<a href="${rel(l, 'apartments/')}">${esc(S[l].nav.apartments)}</a> · <a href="${appHref(l, '#finder')}">${esc(T(l, 'open3d'))}</a>`, `<a href="${rel(l, 'contacts/')}">${esc(S[l].nav.contacts)}</a>`, '', `<a href="${rel(l, 'facts/')}">${esc(S[l].nav.facts)}</a>`, ''];
  let b = `<h1>${esc(p.h1)}</h1><p class="lead">${esc(fill(G.lead, N))}</p>`;
  b += `<h2>${esc(G.hSteps)}</h2><ol>${G.steps.map((s, i) => `<li>${esc(fill(s, N))}${stepLinks[i] ? ` (${stepLinks[i]})` : ''}</li>`).join('')}</ol>`;
  b += `<h2>${esc(G.hPrice)}</h2><p>${esc(st(l, 'terms.priceD', { usdM2: D.USD_PER_M2, rateDate: N.date }).replace(/\.\.$/, '.'))}</p>`
    + `<ul><li>${esc(T(l, 'fPrice'))}: ${esc(T(l, 'fPriceV', N))}</li><li>${esc(T(l, 'fFrom'))}: ${esc(`${S[l].roomsShort[1]} ${N.p1}; ${S[l].roomsShort[2]} ${N.p2}; ${S[l].roomsShort[3]} ${N.p3}`)}</li><li>${esc(T(l, 'fFinish'))}: ${esc(T(l, 'fFinishV'))}</li></ul>`
    + more('apartments/', S[l].nav.apartments);
  b += `<h2>${esc(G.hPay)}</h2><p>${esc(st(l, 'terms.instD'))}</p><ul>${['full', 'inst50', 'inst30'].map(k => `<li><strong>${esc(st(l, `terms.plan.${k}.label`))}</strong> — ${esc(st(l, `terms.plan.${k}.desc`))}</li>`).join('')}</ul>`;
  b += `<h2>${esc(G.hDisc)}</h2><p>${esc(st(l, 'terms.discT'))}: ${esc(st(l, 'terms.discD'))} ${esc(ui(l, 'calc.discountNote'))}</p>`;
  b += `<h2>${esc(G.hProg)}</h2><p>${esc(st(l, 'terms.programs'))}</p>`;
  b += `<h2>${esc(G.hDocs)}</h2><p>${esc(st(l, 'terms.contract.text'))}</p><ul><li>${esc(st(l, 'facts.permit'))}: ${esc(st(l, 'facts.permitV', { n: P.facts.permit.number, d: N.permitDate }))}</li><li>${esc(st(l, 'facts.cadastral'))}: ${esc(N.cad)}</li><li>${esc(st(l, 'facts.customer'))}: ${esc(N.customer)}; ${esc(st(l, 'facts.contractor'))}: ${esc(N.contractor)} — ${esc(st(l, 'facts.perListing'))}</li></ul>`
    + more('facts/', S[l].nav.facts);
  b += `<h2>${esc(G.hDates)}</h2><ul>${[...B_IDS].sort((a, c) => (BLD[a].delivery.year - BLD[c].delivery.year) || (BLD[a].delivery.q - BLD[c].delivery.q) || (BLD[a].no - BLD[c].no)).map(x => `<li><a href="${rel(l, `building-${BLD[x].no}/`)}">${esc(T(l, 'building', { n: BLD[x].no }))}</a> — ${esc(qTxt(l, BLD[x].delivery))} (${esc(statusTxt(l, x))}, ${esc(T(l, 'statusOn', { d: dateTxt(l, BLD[x].statusDate) }))})</li>`).join('')}</ul><p>${esc(G.datesNote)}</p>`
    + more('construction/', S[l].nav.progress);
  b += `<h2>${esc(G.hPark)}</h2><p>${esc(st(l, 'facts.parking'))}: ${esc(st(l, 'facts.parkingV', { n: PARK.std, t: PARK.tandem, m: PARK.moto }))}. ${esc(st(l, 'facts.ev'))}: ${esc(st(l, 'facts.evV', { n: PARK.ev }))}. ${esc(T(l, 'parkPrice'))}</p>`
    + more('parking/', S[l].nav.parking);
  b += `<h2>${esc(G.hContact)}</h2><p>${esc(st(l, 'foot.contactNote'))}</p><dl class="kv">`
    + row(T(l, 'kPhone'), `<a href="tel:${C.phone}">${phoneTxt(C.phone)}</a>`) + row('WhatsApp / Viber', `<a href="${waHref(l)}" rel="noopener">${phoneTxt(C.whatsapp)}</a>`)
    + row(T(l, 'kEmail'), `<a href="mailto:${C.email}">${C.email}</a>`) + row(T(l, 'kOffice'), esc(N.office)) + row(T(l, 'kHours'), esc(N.hours)) + '</dl>' + ctas(l) + priceNote(l);
  b += `<h2>${esc(T(l, 'seeAlso'))}</h2><ul>${[['apartments/', S[l].nav.apartments], ['faq/', S[l].nav.faq], ['facts/', S[l].nav.facts], ['parking/', S[l].nav.parking], ['construction/', S[l].nav.progress], ['location/', S[l].nav.location], ['contacts/', S[l].nav.contacts]].map(([k, t]) => `<li><a href="${rel(l, k)}">${esc(t)}</a></li>`).join('')}</ul>`;
  addPage(l, key, p, b);
}
const guideLink = l => `<p><a href="${rel(l, 'guide/')}">${esc(S[l].guide.link)} →</a></p>`;

// /facts/ — one plain page, Ukrainian + English, for answer engines to quote
function rootFacts() {
  const p = { title: 'ЖК VILNYI, Ужгород — факти / VILNYI, Uzhhorod — key facts', desc: `${T('uk', 'factsDesc')} / ${T('en', 'factsDesc')}`, h1: 'ЖК VILNYI — факти · VILNYI — key facts', og: 'home', crumbs: [] };
  p.canonical = `${BASE}/facts/`;
  const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><meta name="description" content="${esc(p.desc)}"><link rel="canonical" href="${p.canonical}">`
    + `<meta property="og:title" content="${esc(p.title)}"><meta property="og:url" content="${p.canonical}"><meta property="og:image" content="${BASE}/assets/og/home.jpg"><meta name="twitter:card" content="summary_large_image">`
    + `<style>body{margin:0 auto;max-width:860px;padding:16px;font:16px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#fff;color:#111}h1{font-size:22px}h2{font-size:18px;margin-top:28px}a{color:#0645ad}li{margin:3px 0}</style>`
    + `<script type="application/ld+json">${JSON.stringify(graph('en', { ...p, alt: () => '' }, B_IDS.map(b => buildingLd('en', b)), 'AboutPage', true)).replace(/</g, '\\u003c')}</script></head><body>`
    + `<h1>${esc(p.h1)}</h1><p>Оновлено / Updated: __LASTMOD__. Джерело / Source: ${BASE}/ · <a href="/uk/facts/">uk</a> · <a href="/en/facts/">en</a> · <a href="/llms.txt">llms.txt</a></p>`
    + ['uk', 'en'].map(l => `<h2 lang="${l}">${l === 'uk' ? 'Українською' : 'In English'}</h2><ul lang="${l}">${factRows(l).map(([k, vv]) => `<li>${esc(k)}: ${esc(vv)}</li>`).join('')}</ul>`).join('')
    + `<p>${esc(st('uk', 'facts.disclaimer'))}</p><p lang="en">${esc(st('en', 'facts.disclaimer'))}</p></body></html>\n`;
  return { lang: 'xx', key: 'facts/', abs: 'facts/', html };
}

// ---------------------------------------------------------------- llms.txt / llms-full.txt / robots / sitemaps
function llms() {
  const U = nums('uk'), E = nums('en');
  const link = (l, key, name, note) => `- [${name}](${url(l, key)})${note ? ': ' + note : ''}`;
  let s = `# ЖК VILNYI (VILNYI residential complex), Uzhhorod, Ukraine\n\n`;
  s += `> ${st('en', 'hero.lead')} Address: ${st('en', 'loc.addressV')} (${st('uk', 'loc.addressV')}). Developer: VILNYI Group. ${E.n} apartments in 4 buildings (16, 6, 17 and 10 floors). Price: ${D.USD_PER_M2} $ per m² of total area, paid in hryvnia at the official NBU rate (${E.uah} per m² at ${E.rate} UAH/$ on ${RATE.date}). Planned completion: building 2 ${E.q2}, buildings 1 and 3 ${E.q1}, building 4 ${E.q4}. Sales: ${E.phone}, WhatsApp/Viber ${E.wa}, Instagram @vilnyi.uzhhorod.\n\n`;
  s += `Facts on this site come from the project's architectural drawings, the developer (vilnyi.group) and the public lun.ua listing; prices follow one rule (1300 $/m² × NBU rate) and are regenerated daily. Apartment numbering is provisional.\n\n`;
  s += `## Key pages (English)\n${link('en', '', 'Overview')}\n${link('en', 'facts/', 'Key facts', 'one quotable list')}\n${link('en', 'apartments/', 'Apartments and layouts', `${TYPES.length} layouts with plans and prices`)}\n${[1, 2, 3].map(r => link('en', `apartments/${r}-room/`, S.en.roomsPl[r], `from ${E['p' + r]}, ${E['a' + r]}`)).join('\n')}\n${B_IDS.map(b => link('en', `building-${BLD[b].no}/`, `Building ${BLD[b].no}`, `${BLD[b].floors} floors, ${BLD[b].apartments} apartments, completion ${qTxt('en', BLD[b].delivery)}`)).join('\n')}\n${link('en', 'location/', 'Location and what is nearby', 'schools, kindergartens, shops, healthcare, transport with straight-line distances')}\n${link('en', 'parking/', 'Underground parking', `${PARK.std} + ${PARK.tandem} tandem + ${PARK.moto} motorcycle places, ${PARK.ev} EV chargers`)}\n${link('en', 'construction/', 'Construction progress', 'monthly photos')}\n${link('en', 'guide/', 'How to buy', 'price, instalments, discounts, eOselia, contract and documents, steps')}\n${link('en', 'faq/', 'FAQ')}\n${link('en', 'contacts/', 'Contacts')}\n\n`;
  s += `## Основні сторінки (українською)\n${link('uk', '', 'Огляд ЖК VILNYI')}\n${link('uk', 'facts/', 'Ключові факти')}\n${link('uk', 'apartments/', 'Квартири та планування')}\n${[1, 2, 3].map(r => link('uk', `apartments/${r}-room/`, S.uk.roomsPl[r], `від ${U['p' + r]}`)).join('\n')}\n${B_IDS.map(b => link('uk', `building-${BLD[b].no}/`, `Будинок №${BLD[b].no}`)).join('\n')}\n${link('uk', 'location/', 'Розташування')}\n${link('uk', 'parking/', 'Паркінг')}\n${link('uk', 'construction/', 'Хід будівництва')}\n${link('uk', 'guide/', 'Як купити квартиру', 'ціна, розтермінування, знижки, єОселя, договір і документи, кроки')}\n${link('uk', 'faq/', 'Питання та відповіді')}\n${link('uk', 'contacts/', 'Контакти')}\n\n`;
  s += `## Optional\n- [Full facts for language models (uk + en)](${BASE}/llms-full.txt)\n- [Plain facts page](${BASE}/facts/)\n- [Interactive 3D site: finder, 3D walkthrough of every apartment, 360° tour](${BASE}/)\n- Other languages: ${['he', 'ro', 'de', 'fr', 'it'].map(l => `[${S[l].langName}](${url(l)})`).join(', ')}\n`;
  return s;
}
function llmsFull() {
  let s = `# ЖК VILNYI — full facts (Українською + English)\n\nSource: ${BASE}/ · updated __LASTMOD__ · prices at the NBU rate of ${RATE.date}\n\n`;
  for (const l of ['uk', 'en']) {
    const N = nums(l);
    s += `## ${l === 'uk' ? 'Факти' : 'Facts'}\n${factRows(l).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n`;
    s += `## ${l === 'uk' ? 'Будинки' : 'Buildings'}\n${B_IDS.map(b => { const B = BLD[b], us = D.UNITS.filter(u => u.building === b); return `- ${T(l, 'building', { n: B.no })}: ${B.floors} ${T(l, 'floors').toLowerCase()}, ${us.length} (${mixTxt(l, us)}); ${T(l, 'kDelivery')}: ${qTxt(l, B.delivery)}; ${statusTxt(l, b)} (${dateTxt(l, B.statusDate)}) — ${url(l, `building-${B.no}/`)}`; }).join('\n')}\n\n`;
    s += `## ${l === 'uk' ? 'Питання та відповіді' : 'Questions and answers'}\n${S[l].faq.map(([q, a]) => `### ${fill(q, N)}\n${fill(a, N)}`).join('\n\n')}\n\n`;
  }
  s += `## Layouts / Планування (key · building · rooms · total m² · floors · apartments · price UAH · price USD · page)\n`;
  for (const t of TYPES) { const us = unitsOf(t.key); s += `- ${t.key} · B${D.BUILDINGS[t.building].no} · ${t.rooms} · ${t.total} · ${ranges(us.map(u => u.floor))} · ${us.length} · ${us[0].price} · ${us[0].usd} · ${url('en', `layout/${slug(t.key)}/`)}\n`; }
  s += `\n## Nearby / Поруч (straight-line distance from the plot)\n${POIS.filter(x => x.distanceM > 0).sort((a, c) => a.distanceM - c.distanceM).map(x => `- ${x.name.en} / ${x.name.uk}: ${x.approx ? '≈' : ''}${x.distanceM} m`).join('\n')}\n`;
  s += `\n## Construction progress / Хід будівництва\n${[...D.PROGRESS.timeline].sort((a, c) => c.date.localeCompare(a.date)).map(e => `- ${e.date}: ${e.photos.length} photos (${[...new Set(e.photos.map(x => x.building))].join(', ')})`).join('\n')}\n`;
  return s;
}
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot', 'Applebot-Extended', 'Bingbot', 'CCBot', 'Googlebot', 'YandexBot', 'DuckDuckBot', 'Amazonbot', 'meta-externalagent'];
function robots() {
  let s = `# ЖК VILNYI — search engines and AI assistants are welcome to read and cite this site.\n`;
  for (const b of AI_BOTS) s += `\nUser-agent: ${b}\nAllow: /\nDisallow: /crm.html\nDisallow: /dev/\n`;
  s += `\nUser-agent: *\nAllow: /\nDisallow: /crm.html\nDisallow: /dev/\nDisallow: /seo-bot/\n\nSitemap: ${BASE}/sitemap.xml\n`;
  return s;
}

// ---------------------------------------------------------------- build
function buildAll() {
  PAGES.length = 0;
  for (const l of LANGS) {
    pageHome(l); pageApartments(l); for (const r of [1, 2, 3]) pageRooms(l, r);
    for (const t of TYPES) pageLayout(l, t);
    for (const b of B_IDS) pageBuilding(l, b);
    pageLocation(l); pageProgress(l); pageParking(l); pageFaq(l); pageContacts(l); pageFacts(l); pageGuide(l);
  }
  const out = PAGES.map(pg => ({ rel: `${pg.lang}/${pg.key}index.html`, url: url(pg.lang, pg.key), lang: pg.lang, key: pg.key, html: pg.html }));
  const rf = rootFacts(); out.push({ rel: 'facts/index.html', url: `${BASE}/facts/`, lang: 'xx', key: 'facts/', html: rf.html });
  out.push({ rel: 'llms.txt', url: `${BASE}/llms.txt`, lang: 'xx', key: 'llms.txt', html: llms() });
  out.push({ rel: 'llms-full.txt', url: `${BASE}/llms-full.txt`, lang: 'xx', key: 'llms-full.txt', html: llmsFull() });
  return out;
}
// content hash at a fixed dummy rate: tells a real content change from the daily price update
const real = { ...RATE };
D.setRate({ rate: 50, date: '2000-01-01', source: 'hash' });
RATE = { rate: 50, date: '2000-01-01' };
const fixed = new Map(buildAll().map(o => [o.rel, sha(o.html)]));
D.setRate({ rate: real.rate, date: real.date, source: 'НБУ', origin: 'file' });
RATE = real;
const OUT = buildAll();

const STATE_F = path.join(HERE, 'state.json');
let state = { pages: {} };
try { state = JSON.parse(fs.readFileSync(STATE_F, 'utf8')); state.pages ||= {}; } catch (e) { /* first run */ }
const pages = {};
let changed = 0, contentChanged = 0;
for (const o of OUT) {
  const h = sha(o.html), ch = fixed.get(o.rel), old = state.pages[o.url];
  const lastmod = old && old.h === h ? old.lastmod : TODAY;
  if (!old || old.h !== h) changed++;
  if (!old || old.ch !== ch) contentChanged++;
  pages[o.url] = { rel: o.rel, h, ch, lastmod, pinged: old?.pinged || '', pch: old?.pch || '' };
  const fmt = o.lang === 'xx' ? lastmod : dateTxt(o.lang, lastmod);
  o.final = o.html.replaceAll('__LASTMOD_FMT__', fmt).replaceAll('__LASTMOD__', lastmod);
}
const removed = Object.keys(state.pages).filter(u => !pages[u]);

function sitemap(lang) {
  const rows = OUT.filter(o => o.lang === lang).map(o => {
    const alts = LANGS.map(x => `<xhtml:link rel="alternate" hreflang="${x}" href="${url(x, o.key)}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${o.key === '' ? BASE + '/' : url('uk', o.key)}"/>`;
    return `<url><loc>${o.url}</loc><lastmod>${pages[o.url].lastmod}</lastmod>${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
}
const rootLast = [...Object.values(pages)].map(p => p.lastmod).sort().pop();
const rootMap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n<url><loc>${BASE}/</loc><lastmod>${state.root?.lastmod || TODAY}</lastmod>${LANGS.map(x => `<xhtml:link rel="alternate" hreflang="${x}" href="${url(x)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${BASE}/"/></url>\n<url><loc>${BASE}/facts/</loc><lastmod>${pages[`${BASE}/facts/`].lastmod}</lastmod></url>\n</urlset>\n`;
const maps = { 'sitemap-root.xml': rootMap };
for (const l of LANGS) maps[`sitemap-${l}.xml`] = sitemap(l);
const index = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.keys(maps).map(f => { const lm = f === 'sitemap-root.xml' ? rootLast : OUT.filter(o => `sitemap-${o.lang}.xml` === f).map(o => pages[o.url].lastmod).sort().pop(); return `<sitemap><loc>${BASE}/${f}</loc><lastmod>${lm}</lastmod></sitemap>`; }).join('\n')}\n</sitemapindex>\n`;

const files = { ...maps, 'sitemap.xml': index, 'robots.txt': robots() };
for (const o of OUT) files[o.rel] = o.final;
let written = 0;
if (!DRY) {
  for (const [f, s] of Object.entries(files)) {
    const fp = path.join(ROOT, f); fs.mkdirSync(path.dirname(fp), { recursive: true });
    let old = null; try { old = fs.readFileSync(fp, 'utf8'); } catch (e) { /* new */ }
    if (old !== s) { fs.writeFileSync(fp, s); written++; }
  }
  for (const u of removed) { const r = state.pages[u].rel; if (r && /^(uk|en|he|ro|de|fr|it)\//.test(r)) { try { fs.rmSync(path.join(ROOT, r)); fs.rmdirSync(path.dirname(path.join(ROOT, r))); } catch (e) { /* gone */ } } }
  const next = { generator: 'seo-bot/build.mjs', built: TODAY, rate: RATE, root: state.root || { lastmod: TODAY }, lastPing: state.lastPing || null, removed: [...(state.removed || []), ...removed.map(u => ({ url: u, date: TODAY }))].slice(-200), pages };
  fs.writeFileSync(STATE_F, JSON.stringify(next, null, 0).replace(/\},"/g, '},\n"') + '\n');
}
const byType = {}; for (const o of OUT) { const t = o.lang === 'xx' ? o.key : (o.key === '' ? 'home' : o.key.split('/')[0].replace(/^building-\d$/, 'building').replace(/^apartments$/, o.key.split('/').length > 2 ? 'rooms' : 'apartments')); byType[t] = (byType[t] || 0) + 1; }
console.log(JSON.stringify({ today: TODAY, rate: RATE, pages: OUT.length, byType, filesWritten: written, htmlChanged: changed, contentChanged, removed: removed.length }));
