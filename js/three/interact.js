// ЖК VILNYI (Ужгород) — the generic "interactable" registry (V19, owner's instructions of 10 October, v0.7).
//
// Everything the visitor can use with a tap — in the 462 flats, in the common areas and in the cars — is an object that
// carries the walkthrough's tap contract in its userData:
//   userData.action = { type, unitId?, part }   (walk.js _doAction dispatches on it)
//   userData.toggle(on?) → Promise              (on: true / false / undefined = flip)
//   userData.open / userData._open              (current state, read by tests and the HUD)
// The furniture kit (furniture.js) and the builders (apartment.js, commons*.js) create these proxies while they build;
// nothing is registered by hand per flat, so every flat generated from the plans gets them automatically.
// collectInteractables(root) walks a built group once and returns the registry: one record per interactable
//   { kind, name, piece, part, proxy, toggle(on), state() }
// kind is the owner-facing category (tap, shower, flush, cabinet, fridge, oven, hob, hood, washer, dishwasher, curtain,
// light, lamp, window, balconyDoor, door, tv, soundbar, sofaBed, …). Idle items cost nothing per frame: an effect is
// only created / animated while the item runs.

const PART_KIND = {
  tap: 'tap', bathTap: 'tap', bidetTap: 'tap', shower: 'shower', flush: 'flush', toiletLid: 'toiletLid', toiletLidUp: 'toiletLid',
  shampoo: 'pump', chop: 'kitchenPlay', salad: 'kitchenPlay',
  curtain: 'curtain', blind: 'curtain', curtainSwitch: 'switch', balconyDoor: 'balconyDoor', door: 'door', tv: 'tv',
  light: 'light', lamp: 'lamp', window: 'window', hob: 'hob', hood: 'hood', oven: 'oven', fridge: 'fridge', soundbar: 'soundbar',
  microwave: 'microwave', washer: 'washer',
};
const PIECE_KIND = {
  fridge: 'fridge', oven: 'oven', dishwasher: 'dishwasher', washer: 'washer', microwave: 'microwave', wardrobe: 'wardrobe',
  dressing: 'wardrobe', hood: 'hood',
};

export function kindOf(o) {
  const ud = o.userData || {}, a = ud.action || {};
  if (a.type === 'sofaBed') return 'sofaBed';
  if (ud.ia && ud.ia.kind) return ud.ia.kind;
  const part = a.part || ud.playPart;
  if (part === 'cabinet') return PIECE_KIND[ud.piece] || 'cabinet';
  if (part && PART_KIND[part]) return PART_KIND[part];
  if (a.type === 'liftButton' || a.type === 'liftCall') return 'liftButton';
  if (a.type === 'aptDoor' && !part) return 'entranceDoor';
  return part || a.type || 'other';
}

/** root: a built THREE group → registry (see the top of the file). opts.extra: more records (e.g. the sofa-bed). */
export function collectInteractables(root, opts = {}) {
  const out = [], seen = new Set();
  root.traverse(o => {
    const ud = o.userData; if (!ud || !ud.action) return;
    if (ud.action.type === 'sofaBed') return;                      // added once below (two colliders, one bed)
    const tg = ud.toggle; if (typeof tg !== 'function') return;
    if (seen.has(tg)) return; seen.add(tg);
    out.push({ kind: kindOf(o), name: o.name || '', piece: ud.piece || null, part: ud.action.part || ud.playPart || null, proxy: o,
      toggle: (on) => Promise.resolve(o.userData.toggle(on)), state: () => !!o.userData.open });
  });
  for (const x of opts.extra || []) if (x) out.push(x);
  return out;
}

/** counts per kind: { tap: 3, cabinet: 24, … } */
export function countKinds(list) { const by = {}; for (const it of list) by[it.kind] = (by[it.kind] || 0) + 1; return by; }
