// Lead request flow (modal): 1 contact details → 2 payment option (+ declared discount category) → 3 confirmation.
// PROJECT.features.booking === 'lead': no deposit, no bank transfer, no card payment — the sales office calls back.
// Delivery order: artifact runtime db → PROJECT.leadsEndpoint (POST, needs PROJECT.leadsKey for Web3Forms) →
// localStorage outbox + a copyable summary with direct call / Viber / e-mail buttons (the only path while the endpoint is empty).
import { PROJECT, TYPES, money } from './data.js';
import { t, pick, planText, lang, dir, onLangChange, LANG_CODES, unitLabelL } from './i18n.js';

// ---------- small utils shared with app.js ----------
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;inset-inline-start:-9999px;top:0;opacity:0';
    (dlg?.open ? dlg : document.body).appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
// Wire every [data-copy] button inside root: copies the text of the element referenced by data-copy (id) or data-copy-text.
export function bindCopy(root) {
  root.querySelectorAll('[data-copy],[data-copy-text]').forEach(btn => {
    if (btn._copyBound) return; btn._copyBound = true;
    btn.addEventListener('click', async () => {
      const txt = btn.dataset.copyText ?? document.getElementById(btn.dataset.copy)?.textContent ?? '';
      const ok = await copyText(txt.trim());
      const lbl = btn.querySelector('.copy-l') || btn;
      const old = lbl.textContent; lbl.textContent = ok ? t('bk.copied') : '—';
      btn.classList.add('is-done'); setTimeout(() => { lbl.textContent = old; btn.classList.remove('is-done'); }, 1600);
    });
  });
}

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

// Artifact runtime db (resolves null outside claude.ai or when not granted). Never blocks longer than `ms`.
let dbPromise = null;
export function getDb(ms = 5000) {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        if (!window.claude?.use) return null;
        return await Promise.race([window.claude.use('db'), new Promise(r => setTimeout(() => r(null), 11000))]);
      } catch (e) { return null; }
    })();
  }
  return Promise.race([dbPromise, new Promise(r => setTimeout(() => r(null), ms))]);
}

// Reserved unit ids from db + this browser. A lead REQUEST is not a reservation and is never returned here.
export async function loadReservations() {
  const ids = new Set(lsGet('vrc.reservations', []).filter(r => r?.unitId && r.status !== 'cancelled').map(r => r.unitId));
  const db = await getDb(8000);
  if (db) {
    try {
      const snap = await db.collection('reservations').get();
      snap.docs.forEach(d => { const v = d.data(); if (v?.unitId && v.status !== 'cancelled') ids.add(v.unitId); });
    } catch (e) { /* read not allowed / offline */ }
  }
  return ids;
}

// ---------- payment plan maths (used by the calculator too) — CONTRACT §1.12 ----------
// planBreakdown(1000000, plans[2], { discountPct: 5 }) → net 950000, first 285000, rest 665000, monthly ≈ 39118.
export function planBreakdown(price, plan, opts = {}) {
  const split = plan?.split || [100, 0];
  const months = plan?.months || 0;
  const discountPct = Number(opts.discountPct) || 0;
  const net = price * (1 - discountPct / 100);
  const first = net * split[0] / 100;
  const rest = net - first;
  return {
    price, discountPct, discount: price - net, net, first, rest, months, monthly: months ? rest / months : 0,
    deposit: 0, signing: first, signingAfterDeposit: first, delivery: rest, rentYear: 0, rentMonth: 0, rentTotal: 0,   // legacy fields
  };
}

// ISO codes; names come from Intl.DisplayNames in the current language (no hand-kept translations).
const COUNTRIES = ['UA', 'PL', 'SK', 'HU', 'RO', 'CZ', 'DE', 'IL', 'AT', 'IT', 'ES', 'PT', 'CY', 'GB', 'FR', 'NL', 'BE', 'CH', 'MD', 'US', 'CA', 'XX'];
const CODES = ['+380', '+48', '+421', '+36', '+40', '+420', '+49', '+972', '+43', '+39', '+34', '+351', '+357', '+44', '+33', '+31', '+32', '+41', '+373', '+1'];
const CHANNELS = ['viber', 'phone', 'telegram', 'whatsapp', 'email'];
function countryName(code) {
  if (code === 'XX') return t('bk.otherCountry');
  try { return new Intl.DisplayNames([lang, 'en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
}

// ---------- strings this module needs that the dictionaries do not have yet (see notes/T07.md "KEYS FOR I18N") ----------
// A dictionary entry with the same key always wins; this table is only the fallback.
const LOCAL = {
  uk: {
    'bk.emailOpt': 'Електронна пошта (необов’язково)',
    'bk.err.emailNeeded': 'Щоб ми могли написати вам, вкажіть адресу електронної пошти.',
    'bk.discount': 'Категорія знижки',
    'bk.discountOpt': '{label} · −{p}%',
    'bk.discountDeclared': 'Категорію ви зазначаєте самостійно; право на знижку підтверджує відділ продажу.',
    'bk.upTo': 'до {m} міс.',
    'bk.readyTitle': 'Заявку підготовлено',
    'bk.readyLead': '{name}, залишився один крок: надішліть заявку у відділ продажу — у Viber чи електронною поштою — або зателефонуйте нам.',
    'bk.viberHint': 'Підсумок скопійовано — вставте його в чат Viber.',
    'bk.office': 'Відділ продажу',
    'bk.hours': 'Пн–Пт {a}, Сб {b}',
    'bk.est': 'орієнтовна',
  },
  en: {
    'bk.emailOpt': 'Email (optional)',
    'bk.err.emailNeeded': 'Please enter your email address so that we can write to you.',
    'bk.discount': 'Discount category',
    'bk.discountOpt': '{label} · −{p}%',
    'bk.discountDeclared': 'You state the category yourself; eligibility for the discount is confirmed by the sales office.',
    'bk.upTo': 'up to {m} mo',
    'bk.readyTitle': 'Your request is ready',
    'bk.readyLead': '{name}, one step is left: send the request to the sales office on Viber or by email, or give us a call.',
    'bk.viberHint': 'Summary copied — paste it into the Viber chat.',
    'bk.office': 'Sales office',
    'bk.hours': 'Mon–Fri {a}, Sat {b}',
    'bk.est': 'estimate',
  },
};
function L(key, vars) {
  const s = t(key, vars);
  if (s !== key) return s;
  const raw = LOCAL[lang]?.[key] ?? LOCAL.uk[key] ?? LOCAL.en[key] ?? key;   // same fallback order as t(): current → uk → en
  return raw.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));
}

// ---------- formatting ----------
const commaLang = () => lang === 'uk' || lang === 'ru';
function fmtArea(n) {
  const s = Number(n).toFixed(2);
  return commaLang() ? s.replace('.', ',') + ' м²' : s + ' m²';
}
const roomsLabel = u => (u.rooms === 1 ? t('rooms.1') : t('rooms.n', { n: u.rooms }));
const facingLabel = u => (u.facing ? t('face.' + u.facing) : '');
const unitLine = u => [roomsLabel(u), fmtArea(TYPES[u.type]?.total ?? u.area ?? 0), facingLabel(u)].filter(Boolean).join(' · ');
// '+380500100723' → '+38 050 010 07 23' (Ukrainian numbers only; anything else is returned as stored)
function fmtPhone(p) {
  const m = /^\+38(0\d{2})(\d{3})(\d{2})(\d{2})$/.exec(String(p || '').replace(/[^\d+]/g, ''));
  return m ? `+38 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : String(p || '');
}
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const lead = () => PROJECT.features?.booking === 'lead' || PROJECT.terms?.reservationDeposit == null;
const plans = () => PROJECT.terms?.plans || [];
const discounts = () => PROJECT.terms?.discounts || [];
const discountOf = id => discounts().find(d => d.id === id) || null;
function discountLabel(d) { const k = 'terms.disc.' + d.id; const s = t(k); return s !== k ? s : pick(d.label); }
const curPlan = () => plans().find(p => p.id === S.planId) || plans()[0];
const curBreakdown = (p = curPlan()) => planBreakdown(S.unit.price, p, { discountPct: discountOf(S.f.discount)?.percent || 0 });

// ---------- styles for the few elements site.css does not know (injected once; site.css is owned by another task) ----------
function ensureCss() {
  if (document.getElementById('bk-lead-css')) return;
  const st = document.createElement('style'); st.id = 'bk-lead-css';
  st.textContent = `
.booking .bk-hp{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.booking .bk-unit-s{line-height:1.5}
[dir="rtl"] .booking .phone select{background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%}
.booking .bk-unit-p{text-align:end}
.booking .bk-unit-p small{display:block;margin-top:5px;font:400 11px/1.2 var(--f-body);color:var(--muted);white-space:nowrap}
.booking .chips-fld .chips{row-gap:8px}
.booking .bk-disc .chip span{white-space:normal;text-align:start;line-height:1.3;padding-block:6px}
.booking .bk-disc .fine{margin-top:8px}
.booking .po-n b small{font:400 11px/1.2 var(--f-body);color:var(--muted);margin-inline-start:6px}
.booking .bk-net{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:14px 16px;border:1px solid var(--line-2);background:var(--bg-2)}
.booking .bk-net span{font-size:12px;color:var(--muted)}
.booking .bk-net s{color:var(--dim);font-size:13px;margin-inline-end:10px}
.booking .bk-net b{font:500 24px/1 "Cormorant Garamond",serif;color:var(--gold-hi);direction:ltr;white-space:nowrap}
.booking .bk-reach{display:grid;gap:8px}
@media (min-width:600px){.booking .bk-reach{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}}
.booking .bk-reach .btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:auto;min-height:58px;padding:9px 12px;white-space:normal;line-height:1.25;text-align:center}
.booking .bk-reach .btn small{font:500 12.5px/1.2 var(--f-body);letter-spacing:.02em;text-transform:none;opacity:.85;direction:ltr;overflow-wrap:anywhere}
.booking .bk-hint{min-height:1.2em;margin:0;font-size:12.5px;color:var(--ok)}
.booking .bk-office{margin:0;font-size:12.5px;color:var(--muted)}
.booking .bk-done .notice{text-align:start}
.booking .bk-done .summary{max-height:260px;overflow:auto}
`;
  document.head.appendChild(st);
}

// ---------- modal ----------
let dlg = null; let S = null; let unbindLang = null;

function ensureDialog() {
  if (dlg) return dlg;
  ensureCss();
  dlg = document.createElement('dialog');
  dlg.className = 'modal booking'; dlg.setAttribute('aria-labelledby', 'bk-title');
  document.body.appendChild(dlg);
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  return dlg;
}

function close() {
  if (!dlg?.open) return;
  dlg.classList.add('is-closing');
  setTimeout(() => { dlg.classList.remove('is-closing'); dlg.close(); document.documentElement.classList.remove('modal-open'); S?.returnFocus?.focus?.(); unbindLang?.(); unbindLang = null; }, 180);
}

// opts: unit (required), planId, discount ('military' | 'medical'), onLead(fields) after step 1,
// onRequested(unitId, result, doc) when the request is completed. onReserved is called only in a (future) deposit mode:
// a request does not reserve the apartment, so the unit keeps its status.
export function openBooking({ unit, planId, discount = '', onReserved = () => {}, onLead = () => {}, onRequested = () => {} } = {}) {
  if (!unit) return;
  ensureDialog();
  const saved = lsGet('vrc.contact', {});
  const ps = plans();
  S = {
    unit, step: 1, planId: ps.some(p => p.id === planId) ? planId : ps[0]?.id, onReserved, onLead, onRequested, returnFocus: document.activeElement,
    f: {
      name: saved.name || '', email: saved.email || '', code: CODES.includes(saved.code) ? saved.code : '+380', phone: saved.phone || '',
      country: COUNTRIES.includes(saved.country) ? saved.country : 'UA', prefLang: LANG_CODES.includes(saved.prefLang) ? saved.prefLang : lang,
      contactBy: CHANNELS.includes(saved.contactBy) ? saved.contactBy : 'viber', discount: discountOf(discount) ? discount : '', consent: false, hp: '',
    },
    errors: {}, result: null, sending: false, hint: '',
  };
  render();
  if (!dlg.open) dlg.showModal();
  document.documentElement.classList.add('modal-open');
  unbindLang = onLangChange(() => render());
  setTimeout(() => dlg.querySelector('.modal-body input:not([tabindex="-1"]),button.primary')?.focus(), 30);
}

function stepper() {
  const steps = ['bk.step1', 'bk.step2', 'bk.step3'];
  return `<ol class="steps" aria-label="${esc(t('bk.title'))}">${steps.map((k, i) => `<li class="${i + 1 < S.step ? 'done' : ''}${i + 1 === S.step ? ' cur' : ''}" ${i + 1 === S.step ? 'aria-current="step"' : ''}><span class="n">${i + 1}</span><span class="l">${esc(t(k))}</span></li>`).join('')}</ol>`;
}

function unitSummaryHtml() {
  const u = S.unit;
  return `<div class="bk-unit"><div><div class="bk-unit-l" dir="${dir}">${esc(unitLabelL(u))}</div><div class="bk-unit-s">${esc(unitLine(u))}</div></div>
    <div class="bk-unit-p">${esc(money(u.price))}${u.ppm ? `<small>${esc(money(u.ppm) + t('unit.perM2Short'))}</small>` : ''}</div></div>`;
}

function field(id, label, input, err) {
  return `<div class="fld${err ? ' has-err' : ''}"><label for="${id}">${esc(label)}</label>${input}${err ? `<p class="err" id="${id}-err">${esc(err)}</p>` : ''}</div>`;
}
const invalid = (id, err) => (err ? `aria-invalid="true" aria-describedby="${id}-err"` : '');

function stepDetails() {
  const f = S.f, E = S.errors;
  return `<form class="bk-form" novalidate>
    ${field('bk-name', t('bk.name'), `<input id="bk-name" name="name" autocomplete="name" maxlength="80" value="${esc(f.name)}" required ${invalid('bk-name', E.name)}>`, E.name)}
    <div class="row2">
    ${field('bk-phone', t('bk.phone'), `<div class="phone" dir="ltr"><select id="bk-code" name="code" aria-label="${esc(t('bk.code'))}" autocomplete="tel-country-code">${CODES.map(c => `<option ${c === f.code ? 'selected' : ''}>${c}</option>`).join('')}</select><input id="bk-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="20" value="${esc(f.phone)}" required ${invalid('bk-phone', E.phone)}></div>`, E.phone)}
    ${field('bk-email', L('bk.emailOpt'), `<input id="bk-email" name="email" type="email" inputmode="email" autocomplete="email" dir="ltr" maxlength="120" value="${esc(f.email)}" ${invalid('bk-email', E.email)}>`, E.email)}
    </div>
    <div class="bk-hp" aria-hidden="true"><label for="bk-website">Website</label><input id="bk-website" name="website" type="text" tabindex="-1" autocomplete="off" value=""></div>
    <fieldset class="fld chips-fld"><legend>${esc(t('bk.contactBy'))}</legend><div class="chips">${CHANNELS.map(c => `<label class="chip"><input type="radio" name="contactBy" value="${c}" ${c === f.contactBy ? 'checked' : ''}><span>${esc(t('bk.c.' + c))}</span></label>`).join('')}</div></fieldset>
    <div class="row2">
    ${field('bk-country', t('bk.country'), `<select id="bk-country" name="country" autocomplete="country">${COUNTRIES.map(c => `<option value="${c}" ${c === f.country ? 'selected' : ''}>${esc(countryName(c))}</option>`).join('')}</select>`)}
    ${field('bk-lang', t('bk.prefLang'), `<select id="bk-lang" name="prefLang">${LANG_CODES.map(l => `<option value="${l}" ${l === f.prefLang ? 'selected' : ''}>${esc(t('lang.' + l))}</option>`).join('')}</select>`)}
    </div>
    <label class="check${E.consent ? ' has-err' : ''}"><input type="checkbox" name="consent" ${f.consent ? 'checked' : ''} ${E.consent ? 'aria-invalid="true" aria-describedby="bk-consent-err"' : ''}><span>${esc(t('bk.consent'))}</span></label>
    ${E.consent ? `<p class="err" id="bk-consent-err">${esc(E.consent)}</p>` : ''}
    <p class="fine">${esc(t('bk.privacy'))}</p>
    <div class="bk-actions"><button type="button" class="btn ghost" data-act="cancel">${esc(t('bk.cancel'))}</button><button type="submit" class="btn primary">${esc(t('bk.next'))}</button></div>
  </form>`;
}

function planOption(p) {
  const r = curBreakdown(p); const inst = p.months > 0 && r.rest > 0;
  const cell = (k, v, extra = '') => `<span><em>${esc(k)}</em><b>${esc(v)}${extra}</b></span>`;
  const cells = inst
    ? cell(`${t('calc.first')} · ${p.split[0]}%`, money(r.first)) + cell(`${t('calc.rest')} · ${p.split[1]}%`, money(r.rest))
      + cell(`${t('calc.monthlyLabel')} · ${L('bk.upTo', { m: p.months })}`, t('calc.monthly', { m: p.months, v: money(r.monthly) }))
    : cell(t('calc.net'), money(r.net));
  return `<label class="plan-opt"><input type="radio" name="plan" value="${esc(p.id)}" ${p.id === S.planId ? 'checked' : ''}>
    <span class="po-body"><span class="po-t">${esc(planText(p))}</span><span class="po-d">${esc(planText(p, 'desc'))}</span><span class="po-n">${cells}</span></span></label>`;
}

function stepPlan() {
  const f = S.f, ds = discounts(), r = curBreakdown();
  const disc = ds.length ? `<fieldset class="fld chips-fld bk-disc"><legend>${esc(L('bk.discount'))}</legend><div class="chips">
      <label class="chip"><input type="radio" name="discount" value="" ${!f.discount ? 'checked' : ''}><span>${esc(t('calc.none'))}</span></label>
      ${ds.map(d => `<label class="chip"><input type="radio" name="discount" value="${esc(d.id)}" ${d.id === f.discount ? 'checked' : ''}><span>${esc(L('bk.discountOpt', { label: discountLabel(d), p: d.percent }))}</span></label>`).join('')}
    </div><p class="fine">${esc(L('bk.discountDeclared'))} ${esc(t('calc.discountNote'))}</p></fieldset>` : '';
  return `<form class="bk-form" novalidate>
    ${disc}
    <div class="bk-net" aria-live="polite"><span>${esc(t('calc.net'))}${r.discountPct ? ` · ${esc(t('calc.discount'))} −${r.discountPct}%` : ''}</span><b>${r.discountPct ? `<s>${esc(money(r.price))}</s>` : ''}${esc(money(r.net))}</b></div>
    <fieldset class="plans"><legend class="h4">${esc(t('bk.choosePlan'))}</legend>${plans().map(planOption).join('')}</fieldset>
    <p class="fine">${esc(t('calc.disclaimer'))}${S.unit.priceSource === 'rooms' ? ' ' + esc(t('unit.priceEst')) : ''}</p>
    <div class="bk-actions"><button type="button" class="btn ghost" data-act="back" ${S.sending ? 'disabled' : ''}>${esc(t('bk.back'))}</button><button type="submit" class="btn primary" ${S.sending ? 'disabled' : ''}>${esc(S.sending ? t('bk.sending') : t('bk.confirm'))}</button></div>
  </form>`;
}

function reachLinks(sum) {
  const c = PROJECT.contact || {}; const r = S.result; const out = [];
  if (c.phone) out.push(`<a class="btn primary" href="${esc(telHref(c.phone))}"><span>${esc(t('bk.call'))}</span><small>${esc(fmtPhone(c.phone))}</small></a>`);
  if (c.viber) out.push(`<a class="btn gold-outline" data-act="viber" href="viber://chat?number=${encodeURIComponent('+' + String(c.viber).replace(/\D/g, ''))}"><span>${esc(t('bk.sendViber'))}</span><small>${esc(fmtPhone(c.viber))}</small></a>`);
  if (c.whatsapp) out.push(`<a class="btn gold-outline" href="https://wa.me/${String(c.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(sum)}" target="_blank" rel="noopener"><span>${esc(t('bk.sendWa'))}</span><small>${esc(fmtPhone(c.whatsapp))}</small></a>`);
  if (c.email) out.push(`<a class="btn gold-outline" href="mailto:${esc(c.email)}?subject=${encodeURIComponent(PROJECT.name + ' — ' + r.resNo)}&body=${encodeURIComponent(sum)}"><span>${esc(t('bk.sendMail'))}</span><small>${esc(c.email)}</small></a>`);
  return out.join('');
}

function stepDone() {
  const r = S.result; const sum = summaryText(); const c = PROJECT.contact || {};
  const first = S.f.name.trim().split(/\s+/)[0] || '';
  const officeV = t('foot.officeV');
  const office = [officeV !== 'foot.officeV' ? officeV : pick(c.office || ''), c.hours?.['mon-fri'] && c.hours?.sat ? L('bk.hours', { a: c.hours['mon-fri'], b: c.hours.sat }) : ''].filter(Boolean).join(' · ');
  const warn = `<div class="notice" role="note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 10v4M12 16.5v.5" stroke="currentColor" stroke-width="1.6"/></svg><p>${esc(t('bk.savedLocal'))}</p></div>`;
  return `<div class="bk-done"><div class="seal" aria-hidden="true"><img src="assets/brand/group-apple-touch-icon.png" alt="" onerror="this.parentNode.style.display='none'"></div>
    <h3 class="h3" tabindex="-1">${esc(r.remote ? t('bk.leadDone') : L('bk.readyTitle'))}</h3>
    <p>${esc(r.remote ? t('bk.leadLead', { name: first }) : L('bk.readyLead', { name: first }))}</p>
    ${r.remote ? `<p class="fine ok">${esc(t('bk.savedRemote'))}</p>` : warn}
    <div class="bk-reach">${reachLinks(sum)}</div>
    <p class="bk-hint" role="status" aria-live="polite">${esc(S.hint)}</p>
    ${office ? `<p class="bk-office">${esc(L('bk.office'))}: ${esc(office)}</p>` : ''}
    <div class="kv big"><span>${esc(t('bk.resNo'))}</span><b id="bk-resno" dir="ltr">${esc(r.resNo)}</b><button type="button" class="copy" data-copy="bk-resno"><span class="copy-l">${esc(t('bk.copy'))}</span></button></div>
    <h4 class="h5">${esc(t('bk.summary'))}</h4><pre class="summary" id="bk-sum" dir="auto">${esc(sum)}</pre>
    <div class="bk-share"><button type="button" class="btn gold-outline" data-copy="bk-sum"><span class="copy-l">${esc(t('bk.copySummary'))}</span></button></div>
    <div class="bk-actions"><span></span><button type="button" class="btn ghost" data-act="close">${esc(t('bk.close'))}</button></div></div>`;
}

function render() {
  if (!S) return;
  const body = S.step === 1 ? stepDetails() : S.step === 2 ? stepPlan() : stepDone();
  dlg.innerHTML = `<div class="modal-card">
    <header class="modal-head"><div><p class="eyebrow">${esc(PROJECT.name)}</p><h2 id="bk-title" class="h3">${esc(t('bk.title'))}</h2></div>
    <button type="button" class="icon-btn close" data-act="cancel" aria-label="${esc(t('nav.close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6"/></svg></button></header>
    ${stepper()}${S.step < 3 ? unitSummaryHtml() : ''}<div class="modal-body">${body}</div></div>`;
  bind();
}

// Plain-text summary: shown on the confirmation, copied, and prefilled into the e-mail / WhatsApp message.
function summaryText() {
  const u = S.unit, f = S.f, p = curPlan(), r = curBreakdown(p), d = discountOf(f.discount);
  const ppm = u.ppm ? ` (${money(u.ppm)}${t('unit.perM2Short')})` : '';
  const lines = [
    `${PROJECT.name} — ${t('bk.title')}`,
    `${t('bk.resNo')}: ${S.result?.resNo || ''}`,
    `${t('bk.unit')}: ${unitLabelL(u)} (${u.id})`,
    unitLine(u),
    `${t('bk.price')}: ${money(u.price)}${ppm}${u.priceSource === 'rooms' ? ` — ${L('bk.est')}` : ''}`,
    `${t('bk.planChosen')}: ${p ? planText(p) : ''}`,
  ];
  if (d) lines.push(`${t('calc.discount')}: ${discountLabel(d)} −${d.percent}% (−${money(r.discount)})`, `${t('calc.net')}: ${money(r.net)}`);
  if (p && p.months > 0 && r.rest > 0) {
    lines.push(`${t('calc.first')} ${p.split[0]}%: ${money(r.first)}`, `${t('calc.rest')}: ${money(r.rest)}`,
      `${t('calc.monthlyLabel')} (${L('bk.upTo', { m: p.months })}): ${t('calc.monthly', { m: p.months, v: money(r.monthly) })}`);
  }
  lines.push(`${t('bk.name')}: ${f.name}`, `${t('bk.phone')}: ${fullPhone()}`);
  if (f.email) lines.push(`${t('bk.email')}: ${f.email}`);
  lines.push(`${t('bk.contactBy')} ${t('bk.c.' + f.contactBy)}`);
  lines.push(`${t('bk.country')}: ${f.country ? countryName(f.country) : ''} · ${t('bk.prefLang')}: ${t('lang.' + f.prefLang)}`);
  lines.push(new Date(S.result?.createdAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  return lines.join('\n');
}

// National number without the trunk zero or a repeated country code: '+380' + '050 123 45 67' → '+380 501234567'.
function nationalDigits() {
  const cc = S.f.code.replace(/\D/g, ''); let d = S.f.phone.replace(/\D/g, '');
  if (/^\s*(\+|00)/.test(S.f.phone)) { d = d.replace(/^00/, ''); if (d.startsWith(cc)) d = d.slice(cc.length); }
  else if (cc === '380' && d.length === 12 && d.startsWith('380')) d = d.slice(3);
  else if (cc === '380' && d.length === 11 && d.startsWith('80')) d = d.slice(2);
  return d.replace(/^0+/, '');
}
const fullPhone = () => `${S.f.code} ${nationalDigits()}`;

function readForm() {
  const form = dlg.querySelector('form'); if (!form) return;
  const fd = new FormData(form);
  if (S.step === 1) {
    for (const k of ['name', 'email', 'code', 'phone', 'country', 'prefLang', 'contactBy']) if (fd.has(k)) S.f[k] = String(fd.get(k)).trim();
    S.f.name = S.f.name.replace(/\s+/g, ' ');
    S.f.consent = fd.get('consent') === 'on';
    S.f.hp = String(fd.get('website') || '');
  } else if (S.step === 2) {
    S.planId = fd.get('plan') || S.planId;
    if (fd.has('discount')) S.f.discount = discountOf(String(fd.get('discount'))) ? String(fd.get('discount')) : '';
  }
}

function validate() {
  const f = S.f, E = {};
  if ((f.name.match(/\p{L}/gu) || []).length < 2 || /[<>]|https?:|www\./i.test(f.name)) E.name = t('bk.err.name');
  const n = nationalDigits().length;
  if (f.code === '+380' ? n !== 9 : n < 6 || n > 13) E.phone = t('bk.err.phone');
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) E.email = t('bk.err.email');
  else if (!f.email && f.contactBy === 'email') E.email = L('bk.err.emailNeeded');
  if (!CHANNELS.includes(f.contactBy)) f.contactBy = 'viber';
  if (!f.consent) E.consent = t('bk.err.consent');
  S.errors = E; return !Object.keys(E).length;
}

function bind() {
  bindCopy(dlg);
  const form = dlg.querySelector('form');
  form?.addEventListener('submit', async e => {
    e.preventDefault(); readForm();
    if (S.step === 1) {
      if (!validate()) { render(); dlg.querySelector('[aria-invalid="true"]')?.focus(); return; }
      const { consent, hp, discount, ...keep } = S.f; lsSet('vrc.contact', keep);
      try { S.onLead?.({ ...keep }); } catch (err) { /* caller's problem */ }
      S.step = 2; render(); dlg.querySelector('.modal-body input:checked, .modal-body button.primary')?.focus();
    } else if (S.step === 2) { await confirmRequest(); }
  });
  form?.addEventListener('change', e => {
    readForm();
    if (S.step === 2 && e.target.name === 'discount') {            // every plan's figures depend on the discount
      const v = e.target.value; render();
      [...dlg.querySelectorAll('input[name="discount"]')].find(i => i.value === v)?.focus();
    } else if (S.step === 2 && e.target.name === 'plan') { /* nothing to redraw */ }
  });
  dlg.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.act;
    if (a === 'cancel' || a === 'close') close();
    else if (a === 'back') { if (S.sending) return; readForm(); S.step--; render(); }
    else if (a === 'viber') {                                        // Viber links cannot carry a text → put the summary on the clipboard
      const ok = await copyText(summaryText());
      if (ok) { S.hint = L('bk.viberHint'); const h = dlg.querySelector('.bk-hint'); if (h) h.textContent = S.hint; }
    }
  }));
}

function leadDoc() {
  const u = S.unit, f = S.f, p = curPlan(), r = curBreakdown(p), d = discountOf(f.discount);
  return {
    kind: 'request', resNo: S.result?.resNo || null, unitId: u.id, unit: unitLabelL(u), building: u.building, floor: u.floor, apNo: u.apNo ?? null,
    rooms: u.rooms, area: TYPES[u.type]?.total ?? null, price: u.price, ppm: u.ppm ?? null, priceSource: u.priceSource || null, currency: PROJECT.currency || 'UAH',
    plan: p?.id || null, planLabel: p ? planText(p) : '', discount: d?.id || '', discountPct: r.discountPct, discountDeclared: !!d,
    net: Math.round(r.net), first: Math.round(r.first), rest: Math.round(r.rest), months: r.months, monthly: Math.round(r.monthly),
    name: f.name, phone: fullPhone(), email: f.email, country: f.country, prefLang: f.prefLang, contactBy: f.contactBy,
    siteLang: lang, createdAt: S.result?.createdAt || new Date().toISOString(), page: String(location.href).slice(0, 300),
  };
}

// db → endpoint → local. Returns true when stored off-device.
async function saveRecord(collection, doc, id) {
  const db = await getDb(5000);
  if (db) {
    try {
      const col = db.collection(collection);
      if (id) await col.doc(id).set(doc); else await col.add(doc);
      return true;
    } catch (e) { /* not granted → next option */ }
  }
  if (PROJECT.leadsEndpoint) {
    try {
      // Flatten nested fields so the email service shows readable lines
      const flat = { _subject: `${PROJECT.name} — ${doc.resNo || doc.unitId || ''}`.trim(), _template: 'table', collection };
      const walk = (o, pre) => { for (const [k, v] of Object.entries(o || {})) { const key = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key); else flat[key] = Array.isArray(v) ? v.join(', ') : v; } };
      walk(doc, '');
      if (doc.email) { flat._replyto = doc.email; flat.replyto = doc.email; }
      if (PROJECT.leadsKey) { flat.access_key = PROJECT.leadsKey; flat.subject = flat._subject; flat.from_name = `${PROJECT.name} website`; flat.botcheck = ''; }
      const res = await fetch(PROJECT.leadsEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(flat) });
      if (res.ok) return true;
    } catch (e) { /* offline / blocked */ }
  }
  const key = 'vrc.outbox.' + collection; const arr = lsGet(key, []); arr.push(doc); lsSet(key, arr.slice(-50)); // kept for a later manual send (the CRM reads it)
  return false;
}

async function confirmRequest() {
  if (S.sending) return;
  S.sending = true; render();
  const now = new Date();
  const resNo = `VUZ-${S.unit.id.replace(/-/g, '')}-${now.getTime().toString(36).slice(-4).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase().padEnd(2, '0')}`;
  S.result = { resNo, createdAt: now.toISOString(), remote: false };
  const doc = leadDoc();
  // Honeypot filled → a bot: show the same confirmation, store and send nothing.
  if (!S.f.hp) { try { S.result.remote = await saveRecord('leads', doc, resNo); } catch (e) { S.result.remote = false; } }
  S.sending = false; S.step = 3; render();
  if (!S.f.hp) {
    try { S.onRequested?.(S.unit.id, S.result, doc); } catch (e) { /* caller's problem */ }
    if (!lead()) { try { S.onReserved?.(S.unit.id, S.result); } catch (e) { /* caller's problem */ } }
    try { window.dispatchEvent(new CustomEvent('vrc:lead', { detail: { unitId: S.unit.id, resNo, remote: S.result.remote } })); } catch (e) { /* old browser */ }
  }
  dlg.querySelector('.bk-done h3')?.focus?.();
}
