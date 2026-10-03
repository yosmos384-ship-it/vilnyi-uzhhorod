// ЖК VILNYI (Uzhhorod) — procedural texture worker. Runs materials.js's generators on OffscreenCanvas off the main
// thread and posts the finished pixels back as ImageBitmaps; results are kept in IndexedDB (keyed by a hash of
// materials.js) so a returning visitor skips generation entirely. Protocol: {id, styleId, src, three} → {id, entries}.
const DB = 'vrc-tex', STORE = 'styles';
let modP = null, hashP = null;

async function loadMaterials(src, three) {
  // Workers have no import map: fetch materials.js and point its bare 'three' import at the vendor build.
  const code = await (await fetch(src)).text();
  if (!hashP) hashP = crypto.subtle ? crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
    .then(b => [...new Uint8Array(b)].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('')) : Promise.resolve('nohash');
  const js = code.replace(/from\s+['"]three['"]/g, `from ${JSON.stringify(three)}`);
  const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = (db, mode, fn) => new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

async function fromCache(key) {
  try {
    const db = await idb();
    const rec = await tx(db, 'readonly', s => s.get(key)); db.close();
    if (!rec || !Array.isArray(rec.entries)) return null;
    const opt = { premultiplyAlpha: 'default', colorSpaceConversion: 'none' };
    return await Promise.all(rec.entries.map(async ([k, parts]) => [k, await Promise.all(parts.map(async ([p, blob]) => [p, await createImageBitmap(blob, opt)]))]));
  } catch (e) { return null; }
}
async function toCache(key, entries, hash) {
  try {
    const rec = { entries: await Promise.all(entries.map(async ([k, parts]) => [k, await Promise.all(parts.map(async ([p, c]) => [p, await c.convertToBlob({ type: 'image/png' })]))])) };
    const db = await idb();
    await tx(db, 'readwrite', s => {
      s.put(rec, key);
      const q = s.getAllKeys(); q.onsuccess = () => { for (const k of q.result) if (typeof k === 'string' && !k.startsWith(hash + ':')) s.delete(k); };   // drop older versions
    });
    db.close();
  } catch (e) { /* quota / private mode: generation still worked */ }
}

let chain = Promise.resolve();
self.onmessage = ({ data }) => { chain = chain.then(() => handle(data)); };
async function inCache(key) {
  try { const db = await idb(); const n = await tx(db, 'readonly', s => s.count(key)); db.close(); return n > 0; } catch (e) { return false; }
}
async function handle({ id, styleId, src, three, cacheOnly }) {
  try {
    if (!modP) modP = loadMaterials(src, three);
    const mod = await modP, hash = await hashP, key = hash + ':' + styleId;
    if (cacheOnly) {   // just make sure IndexedDB has it (a later real request then only decodes)
      if (!(await inCache(key))) await toCache(key, mod.generateStyleTextures(styleId), hash);
      self.postMessage({ id, cached: await inCache(key) });
      return;
    }
    let entries = await fromCache(key);
    let fresh = null;
    if (!entries) {
      fresh = mod.generateStyleTextures(styleId);
      entries = await Promise.all(fresh.map(async ([k, parts]) => [k, await Promise.all(parts.map(async ([p, c]) => [p, await createImageBitmap(c)]))]));
    }
    const transfer = []; for (const [, parts] of entries) for (const [, bm] of parts) transfer.push(bm);
    self.postMessage({ id, entries }, transfer);
    if (fresh) await toCache(key, fresh, hash);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
}
