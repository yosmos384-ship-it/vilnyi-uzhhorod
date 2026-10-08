// ЖК VILNYI (Ужгород) — the day's official UAH/USD rate of the National Bank of Ukraine (owner, 08.10.2026).
// Static site, no server. Order:
//   1. rate.json at the site root — written every day by the GitHub Actions workflow .github/workflows/nbu-rate.yml
//      ({ "rate": 44.8639, "date": "YYYY-MM-DD", "source": "НБУ" }); fetched without cache.
//   2. only when rate.json is missing / broken / older than today's Kyiv date: the NBU API itself
//      (bank.gov.ua answers with `Access-Control-Allow-Origin: *`, checked 08.10.2026) — a newer date wins.
//   3. otherwise the fallback constant RATE_FALLBACK of data.js stays (data.js starts with it).
// data.js setRate() re-prices every unit in place; this module then refreshes the i18n placeholders {uahM2} / {rateDate}
// and fires `vrc:rate` on window (detail = RATE). Modules re-render on that event (app.js, booking.js, crm).
// Never throws, never logs an error: a failed lookup leaves the fallback.
import { RATE, setRate, getRate } from './data.js';
import { AUTO_VARS } from './i18n.js';

export { getRate };
export const RATE_EVENT = 'vrc:rate';
const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json';
const grp = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || ''); };

export function kyivToday(now = new Date()) {
  for (const tz of ['Europe/Kyiv', 'Europe/Kiev']) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); } catch (e) { /* next */ }
  }
  return new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
}

function syncTexts() { AUTO_VARS.uahM2 = grp(RATE.uahPerM2); AUTO_VARS.rateDate = dmy(RATE.date); }
syncTexts();

async function getJson(url, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl?.signal, credentials: 'omit' });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

function apply(rec, origin) {
  const changed = setRate({ ...rec, origin });
  if (changed) {
    syncTexts();
    try { window.dispatchEvent(new CustomEvent(RATE_EVENT, { detail: RATE })); } catch (e) { /* no window (Node) */ }
  }
  return changed;
}

function fromFile(j) {
  const rate = Number(j?.rate), date = String(j?.date || '');
  return rate > 20 && rate < 200 && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { rate, date, source: j.source || 'НБУ' } : null;
}
function fromNbu(j) {
  const x = Array.isArray(j) ? j.find(r => r && r.cc === 'USD') : null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(x?.exchangedate || ''));
  const rate = Number(x?.rate);
  return m && rate > 20 && rate < 200 ? { rate, date: `${m[3]}-${m[2]}-${m[1]}`, source: 'НБУ' } : null;
}

let _p = null;
// Starts the lookup once; resolves with RATE when finished (whatever the outcome).
export function loadRate({ base = '', fileMs = 4000, nbuMs = 5000 } = {}) {
  if (_p) return _p;
  _p = (async () => {
    const bucket = Math.floor(Date.now() / 300e3);                    // new URL every 5 min: passes the Pages CDN cache (max-age 600)
    const file = fromFile(await getJson(`${base}rate.json?v=${bucket}`, fileMs));
    if (file) apply(file, 'file');
    if (!file || file.date < kyivToday()) {
      const live = fromNbu(await getJson(NBU_URL, nbuMs));
      if (live && (!file || live.date > file.date) && live.date >= RATE.date) apply(live, 'nbu');
    }
    return RATE;
  })();
  return _p;
}

// Wait at most `ms` for the rate (used before the first paint so prices do not change under the visitor's eyes).
export function rateReady(ms = 1200) {
  return Promise.race([loadRate(), new Promise(r => setTimeout(() => r(RATE), ms))]);
}

// cb(RATE) after every change; returns an unsubscribe function.
export function onRate(cb) {
  const h = e => { try { cb(e.detail); } catch (err) { console.warn('[rate] listener:', err); } };
  addEventListener(RATE_EVENT, h);
  return () => removeEventListener(RATE_EVENT, h);
}
