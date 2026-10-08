// ЖК VILNYI (Ужгород) — i18n engine + loader. t(key, vars) with {name} interpolation.
// The strings live in js/i18n/<lang>.ui.js (generic interface) and js/i18n/<lang>.site.js (project copy);
// each file is `export default { 'key': 'text' }`. I18N[l] = { ...ui, ...site }.
// Project facts (prices, areas, permit numbers) are NOT duplicated in the dictionaries — they come from data.js.
// No DOM access at module top level: this file must stay importable in Node (tools/check-i18n.mjs).

import { BUILDINGS, USD_PER_M2, UAH_PER_M2, RATE_DATE } from './data.js';

import ukUi from './i18n/uk.ui.js'; import ukSite from './i18n/uk.site.js';
import enUi from './i18n/en.ui.js'; import enSite from './i18n/en.site.js';
import heUi from './i18n/he.ui.js'; import heSite from './i18n/he.site.js';
import roUi from './i18n/ro.ui.js'; import roSite from './i18n/ro.site.js';
import deUi from './i18n/de.ui.js'; import deSite from './i18n/de.site.js';
import frUi from './i18n/fr.ui.js'; import frSite from './i18n/fr.site.js';
import itUi from './i18n/it.ui.js'; import itSite from './i18n/it.site.js';

// Flags are inline SVG (Windows has no emoji flags). viewBox 3:2, drawn edge to edge.
const F = (body) => `<svg class="flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
const FLAGS = {
  en: F('<rect width="30" height="20" fill="#012169"/><path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" stroke-width="1.4"/><path d="M15 0V20M0 10H30" stroke="#fff" stroke-width="6"/><path d="M15 0V20M0 10H30" stroke="#C8102E" stroke-width="3.4"/>'),
  ro: F('<rect width="10" height="20" fill="#002B7F"/><rect x="10" width="10" height="20" fill="#FCD116"/><rect x="20" width="10" height="20" fill="#CE1126"/>'),
  he: F('<rect width="30" height="20" fill="#fff"/><rect y="2.2" width="30" height="3" fill="#0038B8"/><rect y="14.8" width="30" height="3" fill="#0038B8"/><path d="M15 6.2L18.3 11.9H11.7ZM15 13.8L11.7 8.1H18.3Z" fill="none" stroke="#0038B8" stroke-width=".9"/>'),
  uk: F('<rect width="30" height="10" fill="#0057B7"/><rect y="10" width="30" height="10" fill="#FFD700"/>'),
  fr: F('<rect width="10" height="20" fill="#0055A4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#EF4135"/>'),
  it: F('<rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#CE2B37"/>'),
  de: F('<rect width="30" height="6.67" fill="#000"/><rect y="6.67" width="30" height="6.67" fill="#DD0000"/><rect y="13.33" width="30" height="6.67" fill="#FFCE00"/>'),
};

// Menu order: Ukrainian first (the default), then English and the other languages. `short` is the label shown in the
// header button and in the menu (owner: Hebrew reads "He"; all codes use the same capitalisation).
export const LANGS = [
  { code: 'uk', name: 'Українська', short: 'Ua', dir: 'ltr', flagSvg: FLAGS.uk },
  { code: 'en', name: 'English', short: 'En', dir: 'ltr', flagSvg: FLAGS.en },
  { code: 'he', name: 'עברית', short: 'He', dir: 'rtl', flagSvg: FLAGS.he },
  { code: 'ro', name: 'Română', short: 'Ro', dir: 'ltr', flagSvg: FLAGS.ro },
  { code: 'de', name: 'Deutsch', short: 'De', dir: 'ltr', flagSvg: FLAGS.de },
  { code: 'fr', name: 'Français', short: 'Fr', dir: 'ltr', flagSvg: FLAGS.fr },
  { code: 'it', name: 'Italiano', short: 'It', dir: 'ltr', flagSvg: FLAGS.it },
];
export const LANG_CODES = LANGS.map(l => l.code);
export const DEFAULT_LANG = 'uk';
export const langInfo = code => LANGS.find(l => l.code === code) || LANGS[0];

// Language names are shown in their own language everywhere ('lang.uk' → 'Українська').
const COMMON = Object.fromEntries(LANGS.map(l => ['lang.' + l.code, l.name]));

// One plain, mutable object per language (modules such as i18n-hero.js merge their own strings into it).
// A language whose files are still empty placeholders gives {} here and every lookup falls back to uk.
const dict = (ui, site) => ({ ...(ui || {}), ...(site || {}) });
export const I18N = {
  uk: dict(ukUi, ukSite),
  en: dict(enUi, enSite),
  he: dict(heUi, heSite),
  ro: dict(roUi, roSite),
  de: dict(deUi, deSite),
  fr: dict(frUi, frSite),
  it: dict(itUi, itSite),
};

export let lang = DEFAULT_LANG;
export let dir = 'ltr';

// Price facts every text may use without the caller passing them (data.js is the only place they are written):
//   {usdM2} = 1300 · {uahM2} = '58 283' · {rateDate} = '03.10.2026'
const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || ''); };
export const AUTO_VARS = { usdM2: String(USD_PER_M2), uahM2: String(UAH_PER_M2).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'), rateDate: dmy(RATE_DATE) };

// t('unit.floor', {n: 5}) — fallback chain: current language → Ukrainian → English → the key itself.
export function t(key, vars) {
  let s = I18N[lang]?.[key] ?? COMMON[key] ?? I18N.uk[key] ?? I18N.en[key] ?? key;
  if (typeof s === 'string' && s.includes('{')) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars?.[k] ?? AUTO_VARS[k] ?? m));
  return s;
}

// Pick a {uk, en, …} object from data.js in the current language (falls back to Ukrainian, then English).
// A plain string is returned as it is.
export function pick(obj) {
  if (obj == null) return '';
  if (typeof obj !== 'object') return String(obj);
  return obj[lang] ?? obj.uk ?? obj.en ?? '';
}

// Current-language number formatting for plain counts (prices always use data.js money()).
const LOCALES = { uk: 'uk-UA', he: 'he-IL' };
export function num(n) { try { return Number(n).toLocaleString(LOCALES[lang] || lang); } catch (e) { return String(n); } }

const listeners = new Set();
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// setLang(l)                  — the visitor's own choice (language menu): remembered in localStorage.
// setLang(l, { save: false })  — language not chosen in the menu (page start, ?lang= link): not remembered.
//                                The first call on a page (boot) never saves unless
//                                `save: true` is passed — callers that still do setLang(initialLang()) stay correct.
let booted = false;
export function setLang(l, { save = booted } = {}) {
  if (!LANG_CODES.includes(l)) l = DEFAULT_LANG;
  booted = true;
  lang = l; dir = langInfo(l).dir;
  const html = document.documentElement;
  html.lang = l; html.dir = dir;
  if (save) { try { localStorage.setItem('vrc.lang', l); localStorage.setItem('vrc.lang.by', 'user'); } catch (e) { /* storage blocked */ } }
  applyDom(document);
  listeners.forEach(fn => { try { fn(l); } catch (e) { console.error(e); } });
}

// Fill [data-i18n] (textContent), [data-i18n-attr="attr:key;attr2:key2"].
export function applyDom(root) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(';').forEach(pair => { const [a, k] = pair.split(':'); if (a && k) el.setAttribute(a.trim(), t(k.trim())); });
  });
  if (root === document) {
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.desc'));
  }
}

// ---------------------------------------------------------------- initial language: ?lang= → the visitor's saved choice → Ukrainian
// The owner's rule (BRIEF addendum 4, item 1): the site ALWAYS opens in Ukrainian. Nothing about the visitor is looked at —
// no country, IP, time zone or browser language — and no network request is made. Only an explicit `?lang=` link or the
// visitor's own earlier choice in the language menu changes that.
const queryParam = k => { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };
// The visitor's own, remembered choice. A 'vrc.lang' value without the 'vrc.lang.by' mark was written by an old automatic
// start (v0.2 saved whatever it opened in) and is not a choice.
function savedLang() {
  try { const l = localStorage.getItem('vrc.lang'); return localStorage.getItem('vrc.lang.by') === 'user' && LANG_CODES.includes(l) ? l : null; } catch (e) { return null; }
}
export function initialLang() {
  const q = queryParam('lang'); if (LANG_CODES.includes(q)) return q;
  return savedLang() || DEFAULT_LANG;
}

// Object handed to Walkthrough: live getters so a language switch is picked up.
export const i18nApi = {
  t, pick,
  get lang() { return lang; },
  get dir() { return dir; },
  langs: LANGS,
  onChange: onLangChange,
  unitLabel: u => unitLabelL(u),   // localised "Будинок 1 · поверх 5 · кв. 37"
};

// Localised replacement for data.js unitLabel(): "Будинок 1 · поверх 5 · кв. 37" / "Building 1 · floor 5 · apt 37".
// One entrance per tower, so there is no stair / section part. Floor 1 is the ground floor.
export function unitLabelL(u) {
  const no = BUILDINGS?.[u.building]?.no ?? u.building;
  return `${t('ul.building')} ${no} · ${t('ul.floor')} ${u.floor} · ${t('ul.apt')} ${u.apNo}`;
}

// data.js payment plans → translated label/description (dictionary keys terms.plan.<id>.label / .desc);
// when the dictionaries have no such key, the plan's own {uk, en} text is used.
export function planText(p, field = 'label') {
  const k = `terms.plan.${p.id}.${field}`; const s = t(k);
  return s === k ? pick(p[field]) : s;
}
