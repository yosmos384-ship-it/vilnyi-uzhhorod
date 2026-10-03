// ЖК VILNYI (Uzhhorod) — interior design styles and procedural PBR materials (Agent C).
// All textures are generated in code (canvas / pixel loops); UVs on apartment geometry are in metres,
// so every tiling texture is created with `repeat = 1 / tileSizeInMetres`.
import * as THREE from 'three';

export const STYLES = [
  {
    id: 'milano',
    name: { en: 'Milano', he: 'מילאנו', ru: 'Милано', uk: 'Мілано', fr: 'Milano', it: 'Milano', de: 'Milano' },
    blurb: {
      en: 'Dark Italian elegance: walnut herringbone, Nero Marquina marble, brushed brass and charcoal velvet.',
      he: 'אלגנטיות איטלקית כהה: פרקט אגוז בדוגמת אדרה, שיש נרו מרקינה, פליז מוברש וקטיפה בגוון פחם.',
      ru: 'Тёмная итальянская элегантность: орех ёлочкой, мрамор Неро Маркина, латунь и угольный бархат.',
      uk: 'Темна італійська елегантність: горіх «ялинкою», мармур Неро Маркіна, брашована латунь і вугільний оксамит.',
      fr: 'Élégance italienne sombre : noyer à bâtons rompus, marbre Nero Marquina, laiton brossé et velours anthracite.',
      it: 'Eleganza italiana scura: noce a spina di pesce, marmo Nero Marquina, ottone spazzolato e velluto antracite.',
      de: 'Dunkle italienische Eleganz: Nussbaum im Fischgrätmuster, Nero-Marquina-Marmor, gebürstetes Messing und anthrazitfarbener Samt.',
    },
    palette: { floor: '#5b3b27', wall: '#d3cabd', accent: '#2a2623', metal: '#b48c55', fabric: '#3b3a3d', light: '#ffc58c' },
    lightColor: 0xffc38a, lightTemp: 2700,
  },
  {
    id: 'nordic',
    name: { en: 'Nordic', he: 'נורדי', ru: 'Скандинавский', uk: 'Скандинавський', fr: 'Nordique', it: 'Nordico', de: 'Nordisch' },
    blurb: {
      en: 'Bright Scandinavian calm: wide light-oak planks, white walls, natural linen and matte-black details.',
      he: 'שקט סקנדינבי מואר: אלון בהיר בלוחות רחבים, קירות לבנים, פשתן טבעי ופרטים בשחור מט.',
      ru: 'Светлый скандинавский покой: широкая светлая доска из дуба, белые стены, лён и матово-чёрные детали.',
      uk: 'Світлий скандинавський спокій: широка дошка зі світлого дуба, білі стіни, натуральний льон і матово-чорні деталі.',
      fr: 'Calme scandinave lumineux : larges lames de chêne clair, murs blancs, lin naturel et détails noir mat.',
      it: 'Calma scandinava luminosa: plance larghe in rovere chiaro, pareti bianche, lino naturale e dettagli nero opaco.',
      de: 'Helle skandinavische Ruhe: breite Dielen aus heller Eiche, weiße Wände, Naturleinen und mattschwarze Details.',
    },
    palette: { floor: '#cdb38d', wall: '#f1eee8', accent: '#1d1d1d', metal: '#1c1c1c', fabric: '#c9c3b8', light: '#ffd9ab' },
    lightColor: 0xffd6a6, lightTemp: 3000,
  },
  {
    id: 'riviera',
    name: { en: 'Riviera', he: 'ריביירה', ru: 'Ривьера', uk: 'Рив’єра', fr: 'Riviera', it: 'Riviera', de: 'Riviera' },
    blurb: {
      en: 'A Mediterranean holiday at home: travertine, warm sand tones, cane and rattan, olive greens, terracotta accents.',
      he: 'חופשה ים-תיכונית בבית: טרוורטין, גוני חול חמים, קש וראטן, ירוק זית ונגיעות טרקוטה.',
      ru: 'Средиземноморский отпуск дома: травертин, тёплый песок, ротанг и венская сетка, оливковый и терракота.',
      uk: 'Середземноморська відпустка вдома: травертин, теплі піщані відтінки, віденське плетіння й ротанг, оливковий і теракота.',
      fr: 'Des vacances méditerranéennes à la maison : travertin, tons sable chauds, cannage et rotin, vert olive et touches de terre cuite.',
      it: 'Una vacanza mediterranea a casa: travertino, toni sabbia caldi, paglia di Vienna e rattan, verde oliva e accenti in terracotta.',
      de: 'Mittelmeerurlaub zu Hause: Travertin, warme Sandtöne, Wiener Geflecht und Rattan, Olivgrün und Terrakotta-Akzente.',
    },
    palette: { floor: '#d6c3a1', wall: '#e8d9c3', accent: '#6b6f48', metal: '#b89560', fabric: '#ece3d3', light: '#ffcf98' },
    lightColor: 0xffcc94, lightTemp: 2800,
  },
  // `family`: the existing design whose furniture shapes / layout rules a style builds on (furniture.js and
  // apartment.js branch on m.fam); everything visual (materials, palettes, signature pieces) is its own.
  {
    id: 'monaco', family: 'milano',
    name: { en: 'Monaco', he: 'מונאקו', ru: 'Монако', uk: 'Монако', fr: 'Monaco', it: 'Monaco', de: 'Monaco' },
    blurb: {
      en: 'Art-Deco grandeur: Nero Marquina and Calacatta marble, brushed-brass inlays, fluted walnut, emerald and navy velvet, crystal chandeliers.',
      he: 'פאר ארט-דקו: שיש נרו מרקינה וקלקטה, שיבוצי פליז מוברש, אגוז מחורץ, קטיפה בירוק אמרלד ובכחול נייבי, ונברשות קריסטל.',
      ru: 'Роскошь ар-деко: мрамор Неро Маркина и Калакатта, вставки из брашированной латуни, рифлёный орех, изумрудный и тёмно-синий бархат, хрустальные люстры.',
      uk: 'Розкіш ар-деко: мармур Неро Маркіна і Калакатта, вставки з брашованої латуні, рифлений горіх, смарагдовий і темно-синій оксамит, кришталеві люстри.',
      fr: 'Le faste Art déco : marbres Nero Marquina et Calacatta, incrustations de laiton brossé, noyer cannelé, velours émeraude et bleu nuit, lustres en cristal.',
      it: 'Grandeur Art Déco: marmi Nero Marquina e Calacatta, intarsi in ottone spazzolato, noce cannettato, velluto smeraldo e blu notte, lampadari di cristallo.',
      de: 'Art-déco-Grandezza: Nero-Marquina- und Calacatta-Marmor, Intarsien aus gebürstetem Messing, kannelierter Nussbaum, Samt in Smaragd und Nachtblau, Kristalllüster.',
    },
    palette: { floor: '#3e2a1e', wall: '#d8ccb9', accent: '#1d2a44', metal: '#cfa75e', fabric: '#1f4a3a', light: '#ffc488' },
    lightColor: 0xffc286, lightTemp: 2700,
  },
  {
    id: 'kyoto', family: 'nordic',
    name: { en: 'Kyoto', he: 'קיוטו', ru: 'Киото', uk: 'Кіото', fr: 'Kyoto', it: 'Kyoto', de: 'Kyoto' },
    blurb: {
      en: 'Quiet Japandi luxury: pale travertine, oak slats, washi-paper lanterns, natural linen, low furniture, stone basins and warm indirect light.',
      he: 'יוקרה שקטה בסגנון ג׳פנדי: טרוורטין בהיר, רצועות אלון, מנורות נייר וואשי, פשתן טבעי, ריהוט נמוך, כיורי אבן ותאורה עקיפה חמימה.',
      ru: 'Тихая роскошь японди: светлый травертин, дубовые рейки, фонари из бумаги васи, натуральный лён, низкая мебель, каменные раковины и тёплый рассеянный свет.',
      uk: 'Тиха розкіш джапанді: світлий травертин, дубові рейки, ліхтарі з паперу васі, натуральний льон, низькі меблі, кам’яні умивальники й тепле розсіяне світло.',
      fr: 'Luxe discret japandi : travertin clair, tasseaux de chêne, lanternes en papier washi, lin naturel, mobilier bas, vasques en pierre et lumière indirecte chaleureuse.',
      it: 'Lusso silenzioso Japandi: travertino chiaro, listelli di rovere, lanterne in carta washi, lino naturale, arredi bassi, lavabi in pietra e luce indiretta calda.',
      de: 'Leiser Japandi-Luxus: heller Travertin, Eichenlamellen, Washi-Papierleuchten, Naturleinen, niedrige Möbel, Steinwaschbecken und warmes indirektes Licht.',
    },
    palette: { floor: '#d4bf9c', wall: '#e9e1d4', accent: '#3b2f26', metal: '#4a3a2a', fabric: '#d8cebe', light: '#ffcf96' },
    lightColor: 0xffca8e, lightTemp: 2800,
  },
  {
    id: 'paris', family: 'riviera',
    name: { en: 'Paris', he: 'פריז', ru: 'Париж', uk: 'Париж', fr: 'Paris', it: 'Parigi', de: 'Paris' },
    blurb: {
      en: 'Haussmann chic: white boiserie and ceiling cornices, point-de-Hongrie oak parquet, Carrara marble, a marble fireplace, a curved bouclé sofa, pale-blue and blush velvet, antique brass and crystal chandeliers.',
      he: 'שיק פריזאי בסגנון הוסמן: חיפויי קיר לבנים עם פרופילים קלאסיים וקרניזים, פרקט אלון בדוגמת שברון, שיש קררה, אח משיש, ספה מעוגלת מבד בוקלה, קטיפה בתכלת רך ובוורוד עתיק, פליז עתיק ונברשות קריסטל.',
      ru: 'Османовский шик: белые буазери и потолочные карнизы, дубовый паркет «французская ёлка», каррарский мрамор, мраморный камин, изогнутый диван из букле, бархат нежно-голубой и пудрово-розовый, состаренная латунь и хрустальные люстры.',
      uk: 'Османівський шик: білі буазері та стельові карнизи, дубовий паркет «французька ялинка», каррарський мармур, мармуровий камін, вигнутий диван із букле, оксамит ніжно-блакитний і пудрово-рожевий, зістарена латунь і кришталеві люстри.',
      fr: 'Le chic haussmannien : boiseries blanches et corniches, parquet de chêne en point de Hongrie, marbre de Carrare, cheminée en marbre, canapé courbe en bouclé, velours bleu pâle et rose poudré, laiton vieilli et lustres à pampilles de cristal.',
      it: 'Chic haussmanniano: boiserie bianche e cornici a soffitto, parquet di rovere a spina ungherese, marmo di Carrara, camino in marmo, divano curvo in bouclé, velluto azzurro polvere e rosa cipria, ottone anticato e lampadari di cristallo.',
      de: 'Haussmann-Chic: weiße Wandvertäfelung und Deckenstuck, Eichenparkett im französischen Fischgrät, Carrara-Marmor, Marmorkamin, geschwungenes Bouclé-Sofa, Samt in Taubenblau und Puderrosa, Altmessing und Kristalllüster.',
    },
    palette: { floor: '#c9a877', wall: '#f1ede5', accent: '#9db3c6', metal: '#b8935a', fabric: '#ebe4d6', light: '#ffd4a2' },
    lightColor: 0xffdbb8, lightTemp: 3000,
  },
];

// ---------------------------------------------------------------- noise + canvas helpers
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
// Tileable value noise: lattice of `period` cells over the unit square.
function lattice(period, seed) {
  const r = rng(seed), g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => { // x,y in [0,1)
    x *= period; y *= period;
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbmFn(base, oct, seed) {
  const ls = []; for (let o = 0; o < oct; o++) ls.push(lattice(base << o, seed + o * 101));
  return (x, y) => { let v = 0, a = 0.5, n = 0; for (const l of ls) { v += l(x, y) * a; n += a; a *= 0.5; } return v / n; };
}
function canvas(w, h = w) {
  // OffscreenCanvas inside the texture worker (./tex-worker.js); a DOM canvas on the page.
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
// sRGB 0–255 components for canvas painting. (THREE.Color stores linear values, so reading .r/.g/.b directly would
// darken and over-saturate every generated texture.)
const _rgb = {};
function hex(c) { new THREE.Color(c).getRGB(_rgb, THREE.SRGBColorSpace); return [_rgb.r * 255, _rgb.g * 255, _rgb.b * 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgbStr(c, k = 1) { return `rgb(${Math.max(0, Math.min(255, c[0] * k)) | 0},${Math.max(0, Math.min(255, c[1] * k)) | 0},${Math.max(0, Math.min(255, c[2] * k)) | 0})`; }
function pixels(size, fn, h = size) {
  const c = canvas(size, h), ctx = c.getContext('2d'), img = ctx.createImageData(size, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < size; x++) {
    const p = fn(x / size, y / h, x, y); const i = (y * size + x) * 4;
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = p[3] ?? 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}
// Phones upload a ≤ 512 px copy of the (identically generated) canvas: ¼ of the GPU memory and upload time.
const TEX_MAX = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ? 512 : 0;
const _small = new WeakMap();
function uploadSize(c) {
  if (!TEX_MAX || typeof document === 'undefined' || !(c.width > TEX_MAX || c.height > TEX_MAX)) return c;
  let d = _small.get(c);
  if (!d) {
    const k = TEX_MAX / Math.max(c.width, c.height);
    d = canvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
    const x = d.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, d.width, d.height);
    _small.set(c, d);
  }
  return d;
}
function tex(c, { srgb = true, repeat = 1, repeatY } = {}) {
  const t = new THREE.CanvasTexture(uploadSize(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeatY ?? repeat);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const nrm = (c, s, repeat) => tex(normalFromHeight(c, s), { srgb: false, repeat });
// Normal map (tangent space, +Y = up in the texture) from the red channel of a height canvas; wraps at the edges.
function normalFromHeight(src, strength = 2) {
  const w = src.width, h = src.height, sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = sd[i * 4] / 255;
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, yr = y * w;
    for (let x = 0; x < w; x++) {
      const nx = (H[yr + (x - 1 + w) % w] - H[yr + (x + 1) % w]) * strength, ny = (H[yp + x] - H[ym + x]) * strength;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1), i = (yr + x) * 4;
      d[i] = (nx * l * 0.5 + 0.5) * 255; d[i + 1] = (ny * l * 0.5 + 0.5) * 255; d[i + 2] = (l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); return c;
}
// A long strip of real-looking wood figure (grain runs along x): flat-sawn growth rings that arch into cathedrals,
// fine pore streaks and a slow tone drift. Planks are cut from random windows of it (never needs to tile).
const stripCache = new Map();
function grainStrip(base, seed, W = 2048, H = 256, { rings = 9, figure = 1, contrast = 0.42, streaks = 0.16 } = {}) {
  const key = base.join(',') + '|' + seed + '|' + rings + '|' + figure + '|' + contrast;
  if (stripCache.has(key)) return stripCache.get(key);
  const warp = fbmFn(3, 4, seed), slow = fbmFn(2, 3, seed + 9), streak = lattice(256, seed + 4), fleck = lattice(128, seed + 13);
  const early = base.map(x => x * 1.06 + 4), late = base.map(x => x * (1 - contrast));
  const r = rng(seed * 7 + 1), arches = [];
  for (let i = 0; i < 7; i++) arches.push([r(), 0.08 + r() * 0.14, 0.3 + r() * 0.5]);   // centre u, width, depth
  const c = pixels(W, (u, v, x, y) => {
    let t = (v - 0.5) * rings + (warp(u, v) - 0.5) * 2.2 * figure;
    for (const [cu, wdt, dep] of arches) { const du = (u - cu) / wdt; t += dep * figure * 3 * Math.exp(-du * du) * (1 - Math.abs(v - 0.5)); }
    const f = t - Math.floor(t);
    const lw = Math.pow(Math.max(0, Math.sin(f * Math.PI)), 7) * 0.55 + Math.pow(f, 5) * 0.4;
    let col = mix(early, late, Math.min(1, lw));
    const s = (streak(u * 0.06, v) - 0.5) * streaks + (fleck(u, v) - 0.5) * 0.05, k = 0.93 + (slow(u, v) - 0.5) * 0.14 + s;
    return [col[0] * k, col[1] * k, col[2] * k];
  }, H);
  stripCache.set(key, c);
  return c;
}
// Paint one plank (x,y,w,h in canvas px) from a random window of the grain strip; vertical planks are rotated.
function plank(ctx, strip, x, y, w, h, r, tone) {
  const along = w >= h, L = along ? w : h, S = along ? h : w;
  const sx = r() * Math.max(0, strip.width - L), sy = r() * Math.max(0, strip.height - S);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (along) ctx.drawImage(strip, sx, sy, L, S, x, y, L, S);
  else { ctx.translate(x, y + h); ctx.rotate(-Math.PI / 2); ctx.drawImage(strip, sx, sy, L, S, 0, 0, L, S); }
  ctx.restore();
  if (tone !== 1) { ctx.fillStyle = tone < 1 ? `rgba(20,10,4,${(1 - tone).toFixed(3)})` : `rgba(255,244,228,${((tone - 1) * 0.6).toFixed(3)})`; ctx.fillRect(x, y, w, h); }
}
// Heightmaps are drawn alongside the colour: plank faces mid-grey carrying a whisper of grain, V-grooves black.
function woodHeight(hctx, strip, x, y, w, h, r) {
  hctx.fillStyle = '#b4b4b4'; hctx.fillRect(x, y, w, h);
  hctx.globalAlpha = 0.18; plank(hctx, strip, x, y, w, h, r, 1); hctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- texture generators
// Herringbone of orthogonal planks (ratio 4:1). Lattice vectors (1,1) and (4,-4) in plank-width units;
// the texture tile is 8×8 plank widths, which is an exact period of that lattice → seamless.
// Returns colour, normal and roughness canvases.
function herringbone(base, seed, size = 1024) {
  const c = canvas(size), ctx = c.getContext('2d'), U = size / 8;
  const hc = canvas(size), hctx = hc.getContext('2d'), rc = canvas(size), rctx = rc.getContext('2d');
  const strip = grainStrip(base, seed, 2048, 256, { rings: 7, figure: 0.8, contrast: 0.34, streaks: 0.09 });
  const planks = [];
  for (let m = 0; m < 8; m++) { planks.push([m, m, 4, 1]); planks.push([m + 4, m - 3, 1, 4]); }
  for (const [px, py, pw, ph] of planks) {
    const s0 = seed * 31 + px * 7 + py * 131 + pw, rr = rng(s0 + 5)(), tone = 0.87 + rr * 0.2, rough = 170 + rng(s0 + 9)() * 80;
    for (const ox of [-8, 0, 8]) for (const oy of [-8, 0, 8]) {
      const X = (px + ox) * U, Y = (py + oy) * U, W = pw * U, H = ph * U;
      if (X > size || Y > size || X + W < 0 || Y + H < 0) continue;
      plank(ctx, strip, X, Y, W, H, rng(s0), tone);
      woodHeight(hctx, strip, X, Y, W, H, rng(s0));
      rctx.fillStyle = `rgb(${rough | 0},${rough | 0},${rough | 0})`; rctx.fillRect(X, Y, W, H);
    }
  }
  // micro-bevel: dark hairline in colour, groove in height
  for (const [px, py, pw, ph] of planks) for (const ox of [-8, 0, 8]) for (const oy of [-8, 0, 8]) {
    const X = (px + ox) * U + 0.5, Y = (py + oy) * U + 0.5, W = pw * U - 1, H = ph * U - 1;
    ctx.globalAlpha = 0.55; ctx.strokeStyle = rgbStr(base, 0.3); ctx.lineWidth = 1.4; ctx.strokeRect(X, Y, W, H);
    hctx.strokeStyle = '#000'; hctx.lineWidth = 2.5; hctx.strokeRect(X, Y, W, H);
  }
  ctx.globalAlpha = 1;
  rctx.globalAlpha = 0.25; rctx.drawImage(hc, 0, 0); rctx.globalAlpha = 1;
  return { map: c, normal: normalFromHeight(hc, 3.2), rough: rc };
}
// Wide staggered planks (nordic oak). Tile = 2.4 m × 2.4 m, 12 rows of 0.2 m.
function widePlanks(base, seed, size = 1024) {
  const c = canvas(size), ctx = c.getContext('2d'), r = rng(seed);
  const hc = canvas(size), hctx = hc.getContext('2d'), rc = canvas(size), rctx = rc.getContext('2d');
  const strip = grainStrip(base, seed, 2048, 128, { rings: 6, figure: 0.55, contrast: 0.17, streaks: 0.07 });
  const rows = 12, rh = size / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * size * 0.6;
    while (x < size) {
      const len = size * (0.45 + r() * 0.4), s0 = seed + i * 97 + (x * 13 | 0);
      const tone = 0.9 + rng(s0 + 3)() * 0.17, rough = 170 + rng(s0 + 7)() * 80;
      for (const ox of [0, -size, size]) {
        plank(ctx, strip, x + ox, i * rh, len, rh, rng(s0), tone);
        woodHeight(hctx, strip, x + ox, i * rh, len, rh, rng(s0));
        rctx.fillStyle = `rgb(${rough | 0},${rough | 0},${rough | 0})`; rctx.fillRect(x + ox, i * rh, len, rh);
        ctx.fillStyle = rgbStr(base, 0.45); ctx.globalAlpha = 0.6; ctx.fillRect(x + ox, i * rh, 1.2, rh); ctx.globalAlpha = 1;
        hctx.fillStyle = '#000'; hctx.fillRect(x + ox - 1, i * rh, 2.5, rh);
      }
      x += len;
    }
    ctx.fillStyle = rgbStr(base, 0.45); ctx.globalAlpha = 0.55; ctx.fillRect(0, i * rh, size, 1.2); ctx.globalAlpha = 1;
    hctx.fillStyle = '#000'; hctx.fillRect(0, i * rh - 1, size, 2.5);
  }
  rctx.globalAlpha = 0.25; rctx.drawImage(hc, 0, 0); rctx.globalAlpha = 1;
  return { map: c, normal: normalFromHeight(hc, 3), rough: rc };
}
// Travertine / limestone (tileable): near-straight sedimentary bands, cloudiness, and elongated open pores
// (colour + height canvases, so pores also read in the normal map).
function stoneTex(size, c1, c2, { bands = 6, pores = 0.0, seed = 3, contrast = 1 } = {}) {
  const f = fbmFn(4, 5, seed), st = fbmFn(2, 4, seed + 3), gr = lattice(256, seed + 5), cl = fbmFn(3, 4, seed + 11);
  const A = hex(c1), B = hex(c2);
  const c = pixels(size, (u, v) => {
    const w = f(u, v);
    let t = 0.5 + 0.5 * Math.sin((v * bands + (w - 0.5) * 0.7 + (st(u, v) - 0.5) * 0.9) * Math.PI * 2);
    t = Math.pow(t, 2.4) * 0.6 + (w - 0.3) * 0.5 + (cl(u, v) - 0.5) * 0.25;
    const col = mix(A, B, Math.max(0, Math.min(1, t * contrast)));
    const g = (gr(u, v) - 0.5) * 7;
    return [col[0] + g, col[1] + g, col[2] + g];
  });
  const h = canvas(size), hctx = h.getContext('2d'); hctx.fillStyle = '#b0b0b0'; hctx.fillRect(0, 0, size, size);
  if (pores > 0) {
    const ctx = c.getContext('2d'), r = rng(seed * 13 + 5), n = Math.round(size * size * pores * 0.0035);
    const dark = rgbStr(B, 0.62), lip = rgbStr(A, 1.08);
    for (let i = 0; i < n; i++) {
      const x = r() * size, y = r() * size, rx = (1 + r() * r() * 9) * size / 1024 * 2, ry = Math.max(0.6, rx * (0.18 + r() * 0.2));
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        if (x + ox < -20 || x + ox > size + 20 || y + oy < -20 || y + oy > size + 20) continue;
        ctx.fillStyle = lip; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(x + ox, y + oy + ry * 0.8, rx, ry, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = dark; ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, 6.283); ctx.fill();
        hctx.fillStyle = '#202020'; hctx.beginPath(); hctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, 6.283); hctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  c.height_ = h;
  return c;
}
// Marble: cloudy ground + veins drawn as iso-contours of a domain-warped fbm. The contour distance is normalised by
// the field gradient (|n - c| / |∇n|), so a vein keeps a controlled width instead of turning into hairline cracks
// where the field is steep; width swells and thins along the vein, veins fade in and out (real slabs never run a
// vein uniformly), each main vein carries a soft haze, and a finer secondary family crosses them. Everything is
// lattice-periodic → seamless. Returns the colour canvas with `.rough_` (roughness: polished stone, veins a touch
// duller) attached.
function marbleTex(size, base, vein, { seed = 5, vein2, strength = 0.9, network = 0.5, width = 1, levels = [0], scale = 1, turb = 0.4, turb2 = 0.4, haze = 0.35, cloud = 1, gold = 0, rough = 1, smoke = 0 } = {}) {
  const N = size, warpA = fbmFn(2, 4, seed), warpB = fbmFn(2, 4, seed + 31), f1 = fbmFn(3, 4, seed + 57), f2 = fbmFn(4, 4, seed + 61);
  const cl = fbmFn(3, 5, seed + 70), cl2 = fbmFn(8, 3, seed + 73), wv = fbmFn(4, 3, seed + 80), fade = fbmFn(2, 3, seed + 85), fade2 = fbmFn(4, 3, seed + 87), grain = lattice(256, seed + 90);
  const A = hex(base), V = hex(vein), V2 = hex(vein2 || vein), G = hex('#b8955a');
  const Al = A.map(x => Math.min(255, x * 1.12 + 8)), Ad = A.map(x => x * 0.84);
  // Directional "Perlin marble" fields: a diagonal ramp (integer slope → periodic) plus strong turbulence; veins are
  // where the ramp crosses integers, i.e. long meandering streams that never close into loops.
  const F1 = new Float32Array(N * N), F2 = new Float32Array(N * N), k1 = Math.max(1, Math.round(scale));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, wx = warpA(u, v) - 0.5, wy = warpB(u, v) - 0.5, pu = u + wx * 0.35, pv = v + wy * 0.35;
    F1[y * N + x] = (u + v) * k1 + (f1(pu, pv) - 0.5) * 2.6 * turb;
    F2[y * N + x] = (2 * u - v) * k1 + (f2(pu + 0.31, pv - 0.17) - 0.5) * 3.2 * turb2;
  }
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wrapD = (d) => d - Math.round(d);             // neighbour differences across the tile seam (ramp jumps by an integer)
  const dist = (F, x, y, lv) => {
    const i = y * N + x, xl = y * N + (x - 1 + N) % N, xr = y * N + (x + 1) % N, yu = ((y - 1 + N) % N) * N + x, yd = ((y + 1) % N) * N + x;
    const g = Math.hypot(wrapD(F[xr] - F[xl]), wrapD(F[yd] - F[yu])) * N * 0.5 + 0.2;
    let d = 1e9; for (const c of lv) { const f = F[i] + c; d = Math.min(d, Math.abs(f - Math.round(f))); } return d / g;
  };
  const c = canvas(N), ctx = c.getContext('2d'), img = ctx.createImageData(N, N), D = img.data;
  const rc = canvas(N), rctx = rc.getContext('2d'), rimg = rctx.createImageData(N, N), RD = rimg.data;
  const w0 = 0.0035 * width;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const t = cl(u, v), t2 = cl2(u, v);
    let col = t > 0.5 ? mix(A, Al, (t - 0.5) * 1.5 * cloud) : mix(Ad, A, 1 - (0.5 - t) * 2 * cloud);
    col = mix(col, Al, Math.max(0, t2 - 0.55) * 0.5 * cloud);
    if (smoke) col = mix(col, V2, smoke * sm(0.42, 0.85, t) * (0.6 + 0.8 * t2));      // smoky grey drifts (dark marbles)
    const wm = 0.12 + 2.2 * Math.pow(wv(u, v), 2.5), w = w0 * wm;          // veins taper to nothing and swell
    const fm = sm(0.3, 0.55, fade(u, v)), fm2 = sm(0.42, 0.62, fade2(u, v));
    const d1 = dist(F1, x, y, levels), d2 = dist(F2, x, y, [0]);
    const core = Math.exp(-((d1 / w) ** 2)) * fm * strength;
    const hz = Math.exp(-d1 / (w * 7)) * haze * fm * strength;
    const sec = Math.exp(-((d2 / (w0 * 0.45)) ** 2)) * fm2 * network * strength;
    const sh = Math.exp(-d2 / (w0 * 3)) * 0.25 * fm2 * network * strength;
    col = mix(col, V2, Math.min(1, hz + sh));
    col = mix(col, gold ? mix(V, G, gold * sm(0.5, 0.8, t2)) : V, Math.min(1, core + sec * 0.8));
    const g = (grain(u, v) - 0.5) * 4, i = (y * N + x) * 4;
    D[i] = col[0] + g; D[i + 1] = col[1] + g; D[i + 2] = col[2] + g; D[i + 3] = 255;
    const r = (30 + (t2 - 0.5) * 16 + (core + sec) * 30) * rough;         // roughness ≈ 0.12 polished … 0.24 in the veins
    RD[i] = RD[i + 1] = RD[i + 2] = r; RD[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); rctx.putImageData(rimg, 0, 0);
  c.rough_ = rc;
  return c;
}
// Tileable furniture wood (veneer): fine straight grain with a gentle flame figure; rings run along x with an integer
// ring count over the tile → seamless. `.rough_` = satin lacquer (pores a little rougher than the late wood).
// Real veneer is mostly quarter/rift cut: many thin, nearly straight growth lines (≈ 60 per tile), a slow
// low-amplitude drift, flitch-to-flitch tone steps and fine open-pore streaks. The old wide, warped ring figure
// read as cartoon "wavy stripes" at furniture scale. `.height_` (pores + late wood) feeds a normal map.
function woodTile(base, seed, size = 512, { rings = 56, contrast = 0.22 } = {}) {
  const warp = fbmFn(2, 4, seed), fig = fbmFn(3, 3, seed + 2), pore = lattice(256, seed + 4), pore2 = lattice(512, seed + 5), slow = fbmFn(2, 3, seed + 8);
  const early = base.map(x => x * 1.05 + 4), late = base.map(x => x * (1 - contrast));
  const R = new Uint8Array(size * size), Hh = new Uint8Array(size * size);
  const flitch = [], rf = rng(seed * 3 + 1); for (let i = 0; i < 4; i++) flitch.push(0.95 + rf() * 0.1);   // 4 veneer leaves per tile
  const c = pixels(size, (u, v, x, y) => {
    const t = v * rings + (warp(u, v) - 0.5) * 1.6 + (fig(u, v) - 0.5) * 0.8 + Math.sin(u * Math.PI * 2 + v * 6) * 0.2;
    const f = t - Math.floor(t);
    const lw = Math.pow(Math.max(0, Math.sin(f * Math.PI)), 9) * 0.55 + Math.pow(f, 7) * 0.45;
    const p = pore(u * 0.015, v), p2 = pore2(u * 0.03, v);            // pores: short streaks along the grain
    const pr = Math.max(0, p - 0.6) * 1.6 + Math.max(0, p2 - 0.7) * 1.2;
    const col = mix(early, late, Math.min(1, lw * 0.8 + pr * 0.45));
    const k = (0.95 + (slow(u, v) - 0.5) * 0.12) * flitch[Math.min(3, (v * 4) | 0)];
    R[y * size + x] = 140 + lw * 40 + pr * 90;
    Hh[y * size + x] = 180 - lw * 40 - pr * 150;
    return [col[0] * k, col[1] * k, col[2] * k];
  });
  c.rough_ = pixels(size, (u, v, x, y) => { const r = R[y * size + x]; return [r, r, r]; });
  c.height_ = pixels(size, (u, v, x, y) => { const r = Hh[y * size + x]; return [r, r, r]; });
  return c;
}
// Point de Hongrie (French chevron) parquet: planks cut at 45° meeting on straight seams, alternating direction per
// column. Tile = 2 columns × n planks → seamless. Returns colour, normal and roughness canvases.
function chevron(base, seed, size = 1024) {
  const c = canvas(size), ctx = c.getContext('2d'), hc = canvas(size), hctx = hc.getContext('2d'), rc = canvas(size), rctx = rc.getContext('2d');
  const strip = grainStrip(base, seed, 2048, 256, { rings: 6, figure: 0.6, contrast: 0.27, streaks: 0.1 });
  const Wc = size / 2, n = 6, p = size / n, Lp = Wc * Math.SQRT2, T = p / Math.SQRT2, kMin = -Math.ceil(Wc / p) - 1;
  const path = (x, col, k) => { const dir = col ? -1 : 1, x0 = col * Wc, yA = k * p + (col ? Wc : 0); x.beginPath(); x.moveTo(x0, yA); x.lineTo(x0 + Wc, yA + dir * Wc); x.lineTo(x0 + Wc, yA + dir * Wc + p); x.lineTo(x0, yA + p); x.closePath(); return [x0, yA, dir]; };
  for (let col = 0; col < 2; col++) for (let k = kMin; k <= n; k++) {
    const km = ((k % n) + n) % n, s0 = seed * 37 + col * 211 + km * 17, r = rng(s0), tone = 0.84 + r() * 0.24, rough = 165 + r() * 70;
    const sx = r() * (strip.width - Lp - T - 2), sy = r() * (strip.height - T - 1);
    for (const [x, kind] of [[ctx, 0], [hctx, 1], [rctx, 2]]) {
      x.save(); const [x0, yA, dir] = path(x, col, k); x.clip();
      if (kind === 2) { x.fillStyle = `rgb(${rough | 0},${rough | 0},${rough | 0})`; x.fill(); x.restore(); continue; }
      if (kind === 1) { x.fillStyle = '#b4b4b4'; x.fill(); x.globalAlpha = 0.18; }
      x.translate(x0, yA); x.rotate(dir * Math.PI / 4);
      x.drawImage(strip, sx, sy, Lp + 2 * T, T + 1, -T, -0.5, Lp + 2 * T, T + 1);
      if (kind === 0 && tone !== 1) { x.fillStyle = tone < 1 ? `rgba(20,10,4,${(1 - tone).toFixed(3)})` : `rgba(255,244,228,${((tone - 1) * 0.6).toFixed(3)})`; x.fillRect(-T, -1, Lp + 2 * T, T + 2); }
      x.restore();
    }
  }
  for (let col = 0; col < 2; col++) for (let k = kMin; k <= n; k++) {       // micro-bevel on every plank edge
    path(ctx, col, k); ctx.globalAlpha = 0.5; ctx.strokeStyle = rgbStr(base, 0.36); ctx.lineWidth = 1.3; ctx.stroke();
    path(hctx, col, k); hctx.strokeStyle = '#000'; hctx.lineWidth = 2.4; hctx.stroke();
  }
  ctx.globalAlpha = 1;
  rctx.globalAlpha = 0.25; rctx.drawImage(hc, 0, 0); rctx.globalAlpha = 1;
  return { map: c, normal: normalFromHeight(hc, 3), rough: rc };
}
// Parisian bistro mosaic: white octagonal tiles with small black cabochon insets at every corner (n tiles per side).
function cabochonTex(n = 8, size = 512, white = '#f3f1ec', black = '#1b1b1c', grout = '#c9c6bf') {
  const c = canvas(size), ctx = c.getContext('2d'), bump = canvas(size), b = bump.getContext('2d'), t = size / n, q = t * 0.2, gw = Math.max(1.5, size / 300), r = rng(n * 7 + 3);
  ctx.fillStyle = grout; ctx.fillRect(0, 0, size, size); b.fillStyle = '#2a2a2a'; b.fillRect(0, 0, size, size);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * t, y = j * t, g = gw / 2, k = 0.97 + r() * 0.05;
    for (const [cx, fs] of [[ctx, rgbStr(hex(white), k)], [b, '#fff']]) {
      cx.fillStyle = fs; cx.beginPath();
      cx.moveTo(x + q + g, y + g); cx.lineTo(x + t - q - g, y + g); cx.lineTo(x + t - g, y + q + g); cx.lineTo(x + t - g, y + t - q - g);
      cx.lineTo(x + t - q - g, y + t - g); cx.lineTo(x + q + g, y + t - g); cx.lineTo(x + g, y + t - q - g); cx.lineTo(x + g, y + q + g); cx.closePath(); cx.fill();
    }
  }
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = i * t, y = j * t, d = q - gw * 1.2;
    for (const [cx, fs] of [[ctx, black], [b, '#f0f0f0']]) { cx.fillStyle = fs; cx.beginPath(); cx.moveTo(x, y - d); cx.lineTo(x + d, y); cx.lineTo(x, y + d); cx.lineTo(x - d, y); cx.closePath(); cx.fill(); }
  }
  return { map: c, bump };
}
// Tile grid; pattern: 'grid' | 'stack' | 'brick' | 'chevron'
function tileTex({ size = 512, tilesX = 4, tilesY = 4, colors, grout, groutW = 3, pattern = 'grid', seed = 1, glaze = 0.08, surface }) {
  const c = canvas(size), ctx = c.getContext('2d'), r = rng(seed);
  const bump = canvas(size), b = bump.getContext('2d');
  ctx.fillStyle = grout; ctx.fillRect(0, 0, size, size);
  b.fillStyle = '#333'; b.fillRect(0, 0, size, size);
  const tw = size / tilesX, th = size / tilesY;
  const drawTile = (x, y, w, h) => {
    const col = hex(colors[(r() * colors.length) | 0]);
    const k = 1 - glaze + r() * glaze * 2;
    for (const ox of [-size, 0, size]) {
      ctx.fillStyle = rgbStr(col, k); ctx.fillRect(x + ox + groutW / 2, y + groutW / 2, w - groutW, h - groutW);
      b.fillStyle = '#fff'; b.fillRect(x + ox + groutW / 2, y + groutW / 2, w - groutW, h - groutW);
    }
  };
  if (pattern === 'chevron') {
    // zig-zag rows of parallelogram-ish tiles approximated by stripes
    for (let j = 0; j < tilesY; j++) for (let i = 0; i < tilesX; i++) {
      const col = hex(colors[(i + j) % colors.length]);
      ctx.fillStyle = rgbStr(col, 1 - glaze + r() * glaze * 2);
      ctx.beginPath();
      const x = i * tw, y = j * th, up = i % 2 === 0;
      ctx.moveTo(x, y + (up ? th * 0.5 : 0)); ctx.lineTo(x + tw, y + (up ? 0 : th * 0.5));
      ctx.lineTo(x + tw, y + (up ? th : th * 1.5)); ctx.lineTo(x, y + (up ? th * 1.5 : th)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = grout; ctx.lineWidth = groutW; ctx.stroke();
    }
  } else {
    for (let j = 0; j < tilesY; j++) {
      const off = pattern === 'brick' ? (j % 2) * tw / 2 : 0;
      for (let i = -1; i < tilesX; i++) drawTile(i * tw + off, j * th, tw, th);
    }
  }
  if (surface) { ctx.globalAlpha = 0.35; ctx.drawImage(surface, 0, 0, size, size); ctx.globalAlpha = 1; }
  return { map: c, bump };
}
// Grayscale fabric weave / bouclé / velvet (tinted by material colour)
function fabricTex(kind, seed = 2, size = 256) {
  const n = lattice(64, seed), n2 = fbmFn(8, 3, seed + 5), bl = lattice(128, seed + 9);
  return pixels(size, (u, v, x, y) => {
    let t;
    if (kind === 'boucle') { t = 0.8 + (bl(u, v) - 0.5) * 0.34 + (n2(u, v) - 0.5) * 0.1; }
    else if (kind === 'velvet') { t = 0.84 + (n2(u, v) - 0.5) * 0.22 + (n(u, v) - 0.5) * 0.05; }
    else if (kind === 'linen') { const w = ((x % 4 < 2) ^ (y % 4 < 2)) ? 0.05 : -0.02; t = 0.84 + w + (n(u, v) - 0.5) * 0.1 + (n2(u, v) - 0.5) * 0.06; }
    else if (kind === 'knit') { const t2 = knitH(x, y, size); t = 0.72 + t2 * 0.26 + (n(u, v) - 0.5) * 0.06; }
    else if (kind === 'jute') { const w = Math.sin(x * 0.8) * Math.sin(y * 0.8); t = 0.7 + w * 0.18 + (n(u, v) - 0.5) * 0.25; }
    else { const w = ((x % 3 < 1.5) ^ (y % 3 < 1.5)) ? 0.06 : -0.04; t = 0.82 + w + (n(u, v) - 0.5) * 0.14; }
    const g = Math.max(0, Math.min(1, t)) * 255; return [g, g, g];
  }, size);
}
// Stockinette knit: columns of V-shaped stitches (8 columns × 12 rows per tile), each stitch a pair of slanted lobes.
function knitH(x, y, size) {
  const cw = size / 8, rh = size / 12, fx = (x % cw) / cw, fy = (y % rh) / rh;
  const side = fx < 0.5 ? fx * 2 : (1 - fx) * 2;             // 0 at the column edge, 1 at the centre seam
  const lobe = Math.sin(Math.min(1, Math.max(0, (fy + side * 0.45 - 0.1))) * Math.PI);
  return Math.max(0, lobe) * Math.pow(Math.sin(side * Math.PI * 0.5 + 0.2), 0.6);
}
// Weave / pile heightmaps → normal maps (tiny repeat: one tile ≈ 5–8 cm of cloth)
function weaveHeight(kind, seed = 3, size = 256) {
  const n = lattice(64, seed), n2 = lattice(128, seed + 1), n3 = fbmFn(16, 3, seed + 2);
  const T = kind === 'linen' ? 10 : kind === 'boucle' ? 8 : 8;       // thread period (px)
  return pixels(size, (u, v, x, y) => {
    let hgt;
    if (kind === 'knit') {
      hgt = 0.15 + knitH(x, y, size) * 0.8 + (n2(u, v) - 0.5) * 0.12;
    } else if (kind === 'boucle') {
      hgt = 0.5 + (n(u, v) - 0.5) * 0.9 + (n2(u, v) - 0.5) * 0.7 + (n3(u, v) - 0.5) * 0.3;
    } else if (kind === 'velvet') {
      hgt = 0.5 + (n3(u, v) - 0.5) * 0.35 + (n2(u, v) - 0.5) * 0.1;
    } else {
      // plain weave: warp threads (along y) over/under weft threads (along x), slubs for linen
      const i = Math.floor(x / T), j = Math.floor(y / T), fx = (x % T) / T, fy = (y % T) / T;
      const over = (i + j) % 2 === 0;
      const warpP = Math.sin(fx * Math.PI), weftP = Math.sin(fy * Math.PI);
      hgt = over ? 0.55 + warpP * 0.4 * (0.6 + 0.4 * Math.sin(fy * Math.PI)) : 0.55 + weftP * 0.4 * (0.6 + 0.4 * Math.sin(fx * Math.PI));
      hgt += (n(u, v) - 0.5) * (kind === 'linen' ? 0.35 : 0.15);
    }
    const g = Math.max(0, Math.min(1, hgt)) * 255; return [g, g, g];
  }, size);
}
// Effects atlas (4×2 cells, alpha only, white). Row 0: 0 soft disc · 1 soft rectangle · 2 edge gradient (dense at
// the cell's top edge) · 3 downlight "scallop" wash (source at the cell's top centre). Row 1: 4 lamp-shade
// hourglass (light escaping above and below a shade, shade at the cell centre) · 5 sun patch (a soft-edged
// rectangle with window-mullion bars, bright at the top edge) · 6 wide soft falloff (broad bounce light) ·
// 7 corner occlusion (dense at the top edge, fading fast). Used by the contact-shadow (AO) decals and the additive
// light decals; one texture → the decals of each material merge into one draw call.
function fxAtlas(size = 1024) {
  const Hh = size, c = canvas(size, Hh), ctx = c.getContext('2d'), img = ctx.createImageData(size, Hh), d = img.data, H = size / 4, pad = 3;
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < Hh; y++) for (let x = 0; x < size; x++) {
    const cx = Math.floor(x / H), cy = Math.floor(y / H), cell = cy * 4 + cx;
    const lx = x - cx * H, ly = y - cy * H;
    if (lx < pad || ly < pad || lx >= H - pad || ly >= H - pad) continue;
    const u = (lx - pad) / (H - 2 * pad - 1), v = (ly - pad) / (H - 2 * pad - 1);   // 0..1, v down
    const sx = u * 2 - 1, sy = v * 2 - 1;
    let a = 0;
    if (cell === 0) { const r = Math.min(1, Math.hypot(sx, sy)); a = Math.pow(1 - r * r, 2.2); }
    else if (cell === 1) { a = sm(1, 0.35, Math.abs(sx)) * sm(1, 0.35, Math.abs(sy)); a = Math.pow(a, 0.9); }
    else if (cell === 2) { a = Math.pow(1 - v, 2.4) * sm(1, 0.93, Math.abs(sx)); }
    else if (cell === 3) {
      const arc = 0.04 + 0.55 * sx * sx;                // parabolic cut-off line of the beam on the wall
      const inside = v >= arc ? Math.exp(-(v - arc) * 2.2) : Math.exp(-(arc - v) * 30);
      a = inside * Math.pow(Math.max(0, 1 - Math.abs(sx)), 1.3) * sm(1, 0.7, v) * sm(0, 0.08, v) * 0.85;
    } else if (cell === 4) {
      // up-cone from the shade's open top (crisp edges, widening, fading with distance), a dimmer down-cone,
      // and a warm core around the shade itself
      const yy = -sy, ax = Math.abs(sx);
      let up = 0, dn = 0;
      if (yy > 0.08) { const t = yy - 0.08, w = 0.2 + t * 0.62; up = sm(w * 1.08, w * 0.86, ax) * Math.exp(-t * 1.9) * sm(0.08, 0.2, yy); }
      if (yy < -0.12) { const t = -0.12 - yy, w = 0.24 + t * 0.5; dn = sm(w * 1.1, w * 0.85, ax) * Math.exp(-t * 3.2) * 0.55 * sm(-0.12, -0.2, yy); }
      const r = Math.hypot(sx * 1.3, yy * 1.6), core = Math.exp(-r * r * 6) * 0.55;
      a = (up * 0.9 + dn + core) * sm(1, 0.85, ax) * sm(1, 0.9, Math.abs(yy));
    } else if (cell === 5) {
      // sun patch through a 3-bay window: bright near the glass (top), soft penumbra, two mullion shadows
      const edge = sm(1, 0.8, Math.abs(sx)) * sm(1, 0.85, v) * sm(0, 0.04, v);
      const bars = 1 - 0.75 * (Math.exp(-Math.pow((sx + 0.333) * 40, 2)) + Math.exp(-Math.pow((sx - 0.333) * 40, 2)));
      a = edge * bars * (0.45 + 0.55 * Math.pow(1 - v, 1.5));
    } else if (cell === 6) { const r = Math.min(1, Math.hypot(sx, sy)); a = Math.exp(-r * r * 2.6) * sm(1, 0.7, r); }
    else if (cell === 7) { a = Math.pow(1 - v, 5) * sm(1, 0.9, Math.abs(sx)); }
    else if (cell === 8) { a = Math.pow(1 - v, 1.35) * sm(1, 0.8, Math.abs(sx)) * sm(1, 0.97, v); }   // gentle falloff (room depth)
    else { a = 0; }
    const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.max(0, Math.min(255, a * 255));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
// Radial bloom sprite for the camera-facing light halos (bright core + wide soft skirt).
function bloomTex(size = 128) {
  return pixels(size, (u, v) => {
    const r = Math.hypot(u * 2 - 1, v * 2 - 1), a = r >= 1 ? 0 : (Math.exp(-r * r * 12) * 0.85 + Math.exp(-r * r * 3.2) * 0.4) * (1 - r * r);
    return [255, 255, 255, Math.min(255, a * 255)];
  });
}
function plasterTex(seed = 4, strength = 0.06, size = 512) {
  const f = fbmFn(6, 5, seed);
  return pixels(size, (u, v) => { const g = (1 - strength + f(u, v) * strength * 2) * 235; return [g, g, g]; });
}
function limewashTex(seed = 8, size = 512) {
  const f = fbmFn(3, 5, seed), g2 = fbmFn(12, 3, seed + 3);
  return pixels(size, (u, v) => { const t = f(u, v) * 0.75 + g2(u, v) * 0.25; const g = (0.84 + t * 0.2) * 240; return [g, g, g]; });
}
function woodFurnitureTex(base, seed, size = 512, o) { return woodTile(base, seed, size, o); }
// Vienna straw cane (8 cells per tile): paired vertical + horizontal strands, two diagonal strands, octagonal
// see-through holes (dark = the shadowed backing). `.height_` feeds a normal map so the strands catch the light.
function caneTex(base, size = 256) {
  const c = canvas(size), ctx = c.getContext('2d'), col = hex(base), s = size / 8;
  const h = canvas(size), hx = h.getContext('2d');
  ctx.fillStyle = rgbStr(col, 0.34); ctx.fillRect(0, 0, size, size);
  hx.fillStyle = '#000'; hx.fillRect(0, 0, size, size);
  const strand = (x0, y0, x1, y1, w, k) => {
    for (const [cx, cz, lw, a] of [[ctx, rgbStr(col, k * 0.8), w, 1], [ctx, rgbStr(col, k * 1.08), w * 0.45, 1], [hx, '#c8c8c8', w, 1], [hx, '#ffffff', w * 0.4, 1]]) {
      cx.strokeStyle = cz; cx.lineWidth = lw; cx.lineCap = 'butt'; cx.globalAlpha = a;
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { cx.beginPath(); cx.moveTo(x0 + ox, y0 + oy); cx.lineTo(x1 + ox, y1 + oy); cx.stroke(); }
    }
  };
  const r = rng(91);
  for (let i = 0; i < 8; i++) {                         // paired verticals / horizontals (cell edges)
    const t = i * s;
    strand(t - s * 0.13, 0, t - s * 0.13, size, s * 0.16, 0.95 + r() * 0.08); strand(t + s * 0.13, 0, t + s * 0.13, size, s * 0.16, 0.95 + r() * 0.08);
  }
  for (let i = 0; i < 8; i++) { const t = i * s; strand(0, t - s * 0.13, size, t - s * 0.13, s * 0.16, 1.02); strand(0, t + s * 0.13, size, t + s * 0.13, s * 0.16, 1.02); }
  for (let i = -8; i < 16; i++) {                       // diagonals through the cell corners
    strand(i * s, 0, i * s + size, size, s * 0.14, 1.1); strand(i * s + size, 0, i * s, size, s * 0.14, 1.06);
  }
  ctx.globalAlpha = 1; hx.globalAlpha = 1;
  c.height_ = h;
  return c;
}
// Woven rattan lantern (sphere UVs: u around, v top→bottom): tight horizontal wraps over vertical ribs, small gaps
// where the lamp shines through. Returns colour; `.glow_` = emissive mask (gaps bright).
function rattanWeave(base, size = 512) {
  const col = hex(base), n = lattice(64, 17), rows = 72, ribs = 96;
  const G = new Uint8Array(size * size);
  const c = pixels(size, (u, v, x, y) => {
    const fy = (v * rows) % 1, fx = (u * ribs) % 1, row = Math.floor(v * rows), rib = Math.floor(u * ribs);
    const over = (row + rib) % 2 === 0;
    const wrap = Math.sin(fy * Math.PI), ribP = Math.sin(fx * Math.PI);
    let k = over ? 0.72 + 0.4 * wrap : 0.62 + 0.35 * ribP * (0.5 + 0.5 * wrap);
    const gap = Math.max(0, 1 - Math.abs(fy - 0.5) * 12) * Math.max(0, 1 - Math.abs(fx - 0.5) * 10) * (over ? 0 : 1);
    k *= 0.9 + (n(u, v) - 0.5) * 0.3;
    G[y * size + x] = Math.min(255, (Math.pow(1 - wrap, 3) * 0.35 + gap) * 255);
    return [col[0] * k, col[1] * k, col[2] * k];
  });
  c.glow_ = pixels(size, (u, v, x, y) => { const g = G[y * size + x]; return [g, g * 0.82, g * 0.6]; });
  return c;
}
// Rugs (whole rug in UV 0..1): milano = hand-knotted, faded abstract "marbled" wool with a border; nordic = cream
// berber with a hand-drawn diamond lattice; riviera = flat-woven jute (ribbed) with a darker bound edge.
function rugTex(style, size = 1024) {
  const n1 = fbmFn(3, 5, 41), n2 = fbmFn(6, 4, 43), pile = lattice(256, 47), pile2 = lattice(512, 49);
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const P = {
    milano: [hex('#6f6862'), hex('#8d857b'), hex('#4c4641'), hex('#a88f6c')],
    nordic: [hex('#ebe5da'), hex('#d8cfbf'), hex('#c9bfae'), hex('#bfb39f')],
    riviera: [hex('#cdb897'), hex('#bda582'), hex('#8e7658'), hex('#dccbaa')],
    monaco: [hex('#1c2538'), hex('#26304a'), hex('#c7a05c'), hex('#e8dcc4')],
    kyoto: [hex('#d9cfbf'), hex('#cfc3b0'), hex('#9c8c76'), hex('#e6ddcf')],
    paris: [hex('#ece5d8'), hex('#dfd5c5'), hex('#b9a48a'), hex('#d8b3ad')],
  }[style];
  return pixels(size, (u, v, x, y) => {
    const e = Math.min(u, v, 1 - u, 1 - v);                                   // distance to the edge (uv)
    const pl = (pile(u, v) - 0.5) * 0.12 + (pile2(u, v) - 0.5) * 0.08;         // pile / fibre noise
    let col;
    if (style === 'monaco') {
      // Art-Deco: deep navy field, a gold double border, a row of stepped fans along both long sides,
      // and a central lozenge of concentric gold lines; silk-like abrash in the field
      const w = n2(u, v);
      col = mix(P[0], P[1], sm(0.4, 0.75, w) * 0.7);
      const line = (d, c, t) => sm(t, t * 0.4, Math.abs(d - c));
      let g = Math.max(line(e, 0.035, 0.006), line(e, 0.06, 0.003));
      const cx = Math.abs(u - 0.5), cy = Math.abs(v - 0.5), dd = cx * 1.35 + cy;
      for (let k = 1; k <= 4; k++) g = Math.max(g, line(dd, 0.07 * k, 0.0035) * (k === 4 ? 1 : 0.85));
      // fans: half-discs of radiating rays sitting on the inner border line (along u, at both v ends)
      for (const vb of [0.075, 0.925]) {
        const fu = (u * 7) % 1 - 0.5, fv = (v - vb) * (vb < 0.5 ? 1 : -1) * 7, r = Math.hypot(fu, fv);
        if (fv > 0 && r < 0.42) { const a = Math.atan2(fv, fu), ray = sm(0.08, 0.02, Math.abs(((a / Math.PI) * 9) % 1 - 0.5)); g = Math.max(g, (ray * 0.75 + line(r, 0.4, 0.02)) * sm(0.05, 0.12, r)); }
      }
      col = mix(col, P[2], Math.min(1, g));
      if (e < 0.02) col = mix(P[1], P[2], 0.25);
    } else if (style === 'paris') {
      // Aubusson-inspired, faded: cream wool field with a soft abrash, a taupe double border, a blush inner band,
      // an oval medallion of fine concentric lines and quarter-fans in the corners
      const w = n2(u, v), line = (d, c, t) => sm(t, t * 0.4, Math.abs(d - c));
      col = mix(P[0], P[1], sm(0.35, 0.8, w) * 0.8 + (n1(u, v) - 0.5) * 0.3);
      if (e > 0.05 && e < 0.1) col = mix(col, P[3], 0.55 + (w - 0.5) * 0.4);
      let g = Math.max(line(e, 0.045, 0.004), line(e, 0.105, 0.004), line(e, 0.022, 0.006) * 0.7);
      const dd = Math.hypot((u - 0.5) / 0.3, (v - 0.5) / 0.36);
      for (let k = 1; k <= 3; k++) g = Math.max(g, line(dd, 0.33 * k, 0.012) * (0.5 + 0.15 * k));
      if (dd < 0.33) col = mix(col, P[3], 0.4);
      const cu = Math.min(u, 1 - u) - 0.105, cv = Math.min(v, 1 - v) - 0.105, cr = Math.hypot(cu / 0.75, cv);
      if (cu > 0 && cv > 0) { for (let k = 1; k <= 2; k++) g = Math.max(g, line(cr, 0.07 * k, 0.004) * 0.8); if (cr < 0.07) col = mix(col, P[3], 0.4); }
      col = mix(col, P[2], Math.min(1, g) * 0.85);
    } else if (style === 'kyoto') {
      // hand-loomed wool & jute, tatami-like grid of fine raised lines, a wide undyed border
      const rib = 0.5 + 0.5 * Math.sin(y * Math.PI * 2 / 5);
      const gu = 0.5 - Math.abs((u * 6) % 1 - 0.5), gv = 0.5 - Math.abs((v * 4) % 1 - 0.5);
      const grid = e > 0.07 ? Math.max(sm(0.007, 0.002, gu), sm(0.007, 0.002, gv)) : 0;
      col = mix(P[0], P[1], rib * 0.45 + (n1(u, v) - 0.5) * 0.4);
      col = mix(col, P[2], grid * 0.5);
      if (e < 0.07) col = mix(P[3], col, sm(0.055, 0.07, e) * 0.5);
      if (Math.abs(e - 0.07) < 0.0025) col = mix(col, P[2], 0.6);
    } else if (style === 'milano') {
      const t = n1(u, v), w = n2(u, v);
      const band = 0.5 + 0.5 * Math.sin((u * 3 + t * 2.5 + w * 0.8) * Math.PI * 2);
      col = mix(P[0], P[1], sm(0.35, 0.9, band) * 0.8);
      col = mix(col, P[2], sm(0.55, 0.8, w) * 0.45);                           // worn, darker abrash
      col = mix(col, P[3], sm(0.8, 0.95, band) * sm(0.4, 0.7, t) * 0.5);        // faded ochre veins
      if (e < 0.06) col = mix(P[2], P[1], sm(0.03, 0.035, e) * sm(0.045, 0.04, e) * 0.9);   // border + fillet
    } else if (style === 'nordic') {
      const a = (u + v) * 9, b = (u - v) * 9, wob = (n2(u, v) - 0.5) * 0.18;
      const la = Math.abs(a + wob - Math.round(a + wob)), lb = Math.abs(b + wob - Math.round(b + wob));
      const line = Math.max(sm(0.06, 0.02, la), sm(0.06, 0.02, lb));
      col = mix(P[0], P[2], line * 0.75);
      col = mix(col, P[1], (n1(u, v) - 0.4) * 0.5);
      if (e < 0.05) col = mix(P[3], col, sm(0.02, 0.045, e));
    } else {
      const rib = 0.5 + 0.5 * Math.sin(y * Math.PI * 2 / 6), knot = 0.5 + 0.5 * Math.sin(x * Math.PI * 2 / 12 + (y / 6 | 0) * Math.PI);
      col = mix(P[0], P[1], rib * 0.5 + knot * 0.2);
      col = mix(col, P[3], (n1(u, v) - 0.45) * 0.6);
      if (e < 0.05) col = mix(P[2], col, sm(0.035, 0.05, e));
    }
    const k = 1 + pl;
    return [col[0] * k, col[1] * k, col[2] * k];
  });
}
// Abstract art canvases, one family per style
function artTex(style, variant, w = 512, h = 640) {
  const c = canvas(w, h), ctx = c.getContext('2d'), r = rng(variant * 17 + style.length);
  const pal = {
    milano: ['#1d1b1a', '#b48c55', '#6b3b24', '#d9cfc0', '#3d3d40'],
    nordic: ['#f2efe9', '#1d1d1d', '#c9b89a', '#8fa3a8', '#d8cbb5'],
    riviera: ['#efe4d0', '#b5623b', '#6b6f48', '#d9b98a', '#2f4f5f'],
    monaco: ['#14171f', '#c9a25e', '#1f4a3a', '#ece3d2', '#26304a'],
    kyoto: ['#efe8da', '#1e1b18', '#a8483a', '#8c8172', '#d9cdb8'],
    paris: ['#f3eee4', '#1c1a19', '#8ea6bb', '#d9b0aa', '#b8935a'],
  }[style];
  ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, w, h);
  if (style === 'monaco') {
    // Art-Deco: a gold sunburst rising over stepped arches, emerald / navy panels, fine gold rules
    ctx.fillStyle = pal[variant % 2 ? 4 : 0]; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * (0.62 + (variant % 3) * 0.04);
    ctx.fillStyle = pal[2]; ctx.beginPath(); ctx.arc(cx, cy, w * 0.36, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = pal[1]; ctx.lineWidth = 2.2;
    for (let i = 0; i <= 24; i++) { const a = Math.PI + i * Math.PI / 24; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * w * 0.06, cy + Math.sin(a) * w * 0.06); ctx.lineTo(cx + Math.cos(a) * w * 0.44, cy + Math.sin(a) * w * 0.44); ctx.stroke(); }
    ctx.lineWidth = 4; for (const r of [0.12, 0.24, 0.36]) { ctx.beginPath(); ctx.arc(cx, cy, w * r, Math.PI, 0); ctx.stroke(); }
    ctx.fillStyle = pal[3]; ctx.beginPath(); ctx.arc(cx, cy, w * 0.06, Math.PI, 0); ctx.fill();
    ctx.fillStyle = pal[1]; ctx.fillRect(w * 0.08, cy, w * 0.84, 5);
    for (let k = 0; k < 3; k++) { ctx.fillStyle = k % 2 ? pal[4] : pal[2]; ctx.fillRect(w * (0.14 + k * 0.08), cy + 14 + k * 16, w * (0.72 - k * 0.16), 12); }
    ctx.strokeStyle = pal[1]; ctx.lineWidth = 3; ctx.strokeRect(w * 0.05, h * 0.04, w * 0.9, h * 0.92); ctx.lineWidth = 1.2; ctx.strokeRect(w * 0.075, h * 0.06, w * 0.85, h * 0.88);
  } else if (style === 'paris') {
    // Left-Bank gallery piece: paper-cut shapes in blush and pale blue with one continuous ink line (a face / a figure)
    ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = pal[3]; ctx.beginPath(); ctx.ellipse(w * (0.4 + (variant % 3) * 0.08), h * 0.42, w * 0.27, h * 0.25, 0.3 + variant, 0, 6.283); ctx.fill();
    ctx.fillStyle = pal[2]; ctx.beginPath(); ctx.moveTo(w * 0.52, h * 0.5); ctx.bezierCurveTo(w * 0.9, h * 0.42, w * 0.86, h * 0.86, w * 0.56, h * 0.82); ctx.bezierCurveTo(w * 0.44, h * 0.8, w * 0.42, h * 0.56, w * 0.52, h * 0.5); ctx.fill();
    ctx.fillStyle = pal[4]; ctx.beginPath(); ctx.arc(w * (0.7 - (variant % 2) * 0.42), h * 0.2, w * 0.055, 0, 6.283); ctx.fill();
    ctx.strokeStyle = pal[1]; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    const ph = variant * 1.7;
    ctx.moveTo(w * 0.3, h * 0.2);
    ctx.bezierCurveTo(w * 0.52, h * (0.12 + 0.03 * Math.sin(ph)), w * 0.64, h * 0.28, w * 0.5, h * 0.36);
    ctx.bezierCurveTo(w * 0.4, h * 0.42, w * 0.44, h * 0.5, w * 0.56, h * 0.5);
    ctx.bezierCurveTo(w * 0.36, h * 0.56, w * 0.24, h * 0.7, w * 0.34, h * 0.84);
    ctx.bezierCurveTo(w * 0.46, h * 0.94, w * 0.7, h * 0.9, w * 0.74, h * (0.7 + 0.04 * Math.cos(ph)));
    ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.36, h * 0.3); ctx.quadraticCurveTo(w * 0.42, h * 0.27, w * 0.46, h * 0.3); ctx.stroke();
  } else if (style === 'kyoto') {
    // sumi-e on rice paper: an ensō brush circle, or ink mountains in mist, with a red seal
    ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, w, h);
    if (variant % 2 === 0) {
      const cx = w * 0.5, cy = h * 0.45, R = w * 0.3;
      for (let i = 0; i < 260; i++) {
        const t = i / 260, a = -1.2 + t * Math.PI * 1.86, lw = 22 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.9) + 3;
        ctx.globalAlpha = 0.5 + 0.4 * (1 - t); ctx.fillStyle = pal[1];
        for (let k = 0; k < 4; k++) { const jr = R + (r() - 0.5) * lw; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * jr, cy + Math.sin(a) * jr, 1.2 + r() * lw * 0.18, 0, 6.28); ctx.fill(); }
      }
    } else {
      for (let l = 0; l < 3; l++) {
        ctx.globalAlpha = 0.25 + l * 0.25; ctx.fillStyle = l === 2 ? pal[1] : pal[3];
        ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) ctx.lineTo(x, h * (0.45 + l * 0.13) - Math.abs(Math.sin(x * 0.011 + l * 2 + variant)) * h * (0.16 - l * 0.03) - Math.sin(x * 0.05 + l) * 6);
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.fillStyle = pal[2]; ctx.fillRect(w * 0.8, h * 0.8, w * 0.06, w * 0.06);
  } else if (style === 'milano') {
    ctx.fillStyle = pal[3]; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = pal[[0, 2, 4][i]]; ctx.globalAlpha = 0.92;
      ctx.beginPath(); ctx.arc(w * (0.3 + r() * 0.4), h * (0.25 + i * 0.25), w * (0.18 + r() * 0.2), 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = pal[1]; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.8); ctx.bezierCurveTo(w * 0.4, h * 0.2, w * 0.7, h, w * 0.9, h * 0.3); ctx.stroke();
  } else if (style === 'nordic') {
    ctx.strokeStyle = pal[1]; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.01) { const x = w * (0.2 + 0.6 * t), y = h * (0.5 + Math.sin(t * 9 + variant) * 0.2 * (1 - t)); t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = pal[2 + (variant % 3)]; ctx.beginPath(); ctx.arc(w * 0.62, h * 0.32, w * 0.12, 0, 6.28); ctx.fill();
  } else {
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = pal[1 + ((i + variant) % 4)]; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(w * (0.2 + r() * 0.6), h * (0.2 + r() * 0.6), w * (0.08 + r() * 0.18), h * (0.06 + r() * 0.15), r() * 3, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal[4]; ctx.fillRect(0, h * 0.86, w, h * 0.14);
  }
  // canvas grain
  const g = fabricTex('linen', 3, 256); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.25;
  for (let x = 0; x < w; x += 256) for (let y = 0; y < h; y += 256) ctx.drawImage(g, x, y);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  return c;
}
// Leaf: darker margins, lighter midrib and curved secondary veins, a little mottling (UV 0..1 across the blade)
function leafTex(base, size = 256) {
  const col = hex(base), n = fbmFn(4, 3, base.length * 7 + 3);
  const c = pixels(size, (u, v) => {
    const du = Math.abs(u - 0.5) * 2;
    let k = 1.08 - du * du * 0.32 + (n(u, v) - 0.5) * 0.18 - v * 0.08;
    const rib = Math.exp(-(((u - 0.5) * 60) ** 2));                          // midrib
    const ph = (v + du * 0.28) * 9, sv = Math.pow(Math.abs(Math.sin(ph * Math.PI)), 40) * (1 - du) * 0.9; // secondary veins
    k += rib * 0.35 + sv * 0.16;
    return [col[0] * k, col[1] * k * 1.02, col[2] * k];
  });
  return c;
}
function paperBooksTex(size = 64) { // subtle page edges for book blocks
  return pixels(size, (u, v, x, y) => { const g = y % 2 ? 236 : 222; return [g, g - 4, g - 12]; });
}
// Art-Deco hall floor: n×n checkerboard of two marbles laid on the diagonal-free square grid, with a thin brass
// inlay strip in every joint. Returns colour, `.height_` (joints grooved) and `.rough_` (polished stone, brass satin).
function checkerMarble(a, b, n = 2, size = 1024) {
  const c = canvas(size), ctx = c.getContext('2d'), h = canvas(size), hx = h.getContext('2d'), rc = canvas(size), rx = rc.getContext('2d'), t = size / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const src = (i + j) % 2 ? b : a, sw = src.width / n, sh = src.height / n, sx = ((i + 1) % n) * sw, sy = ((j + 1) % n) * sh;   // each tile its own window of the slab
    ctx.drawImage(src, sx, sy, sw, sh, i * t, j * t, t, t);
    if (src.rough_) rx.drawImage(src.rough_, sx, sy, sw, sh, i * t, j * t, t, t);
  }
  hx.fillStyle = '#b0b0b0'; hx.fillRect(0, 0, size, size);
  const bw = Math.max(2, size / 220);
  ctx.fillStyle = '#c7a25e'; rx.fillStyle = '#5a5a5a'; hx.fillStyle = '#909090';
  for (let k = 0; k <= n; k++) {
    const p = k * t - bw / 2;
    ctx.fillRect(p, 0, bw, size); ctx.fillRect(0, p, size, bw);
    rx.fillRect(p, 0, bw, size); rx.fillRect(0, p, size, bw);
    hx.fillRect(p, 0, bw, size); hx.fillRect(0, p, size, bw);
  }
  // hairline shadow either side of the brass
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let k = 0; k <= n; k++) { const p = k * t; ctx.fillRect(p - bw / 2 - 1, 0, 1, size); ctx.fillRect(p + bw / 2, 0, 1, size); ctx.fillRect(0, p - bw / 2 - 1, size, 1); ctx.fillRect(0, p + bw / 2, size, 1); }
  c.height_ = h; c.rough_ = rc;
  return c;
}
// Washi paper (lantern shades): long translucent fibres and a soft cloudiness; horizontal bamboo ribs every
// `ribs` rows (v = 0..1 down the shade). `.glow_` = emissive mask: paper glows, ribs and thick fibres read darker.
function washiTex(ribs = 9, size = 512) {
  const f = fbmFn(4, 4, 61), fib = lattice(256, 63), fib2 = lattice(512, 64);
  const G = new Uint8Array(size * size);
  const c = pixels(size, (u, v, x, y) => {
    const fy = (v * ribs) % 1, rib = Math.exp(-Math.pow((Math.min(fy, 1 - fy)) * 38, 2));
    const fibre = Math.max(0, fib(u * 0.08, v * 1.4) - 0.62) * 1.6 + Math.max(0, fib2(u * 0.05, v * 2) - 0.7) * 1.4;
    const cl = f(u, v);
    const k = 0.93 + (cl - 0.5) * 0.1 - fibre * 0.1 - rib * 0.32;
    G[y * size + x] = Math.max(0, Math.min(255, (0.78 + (cl - 0.5) * 0.35 - fibre * 0.35 - rib * 0.7) * 255));
    return [244 * k, 236 * k, 220 * k];
  });
  c.glow_ = pixels(size, (u, v, x, y) => { const g = G[y * size + x]; return [g, g * 0.86, g * 0.66]; });
  return c;
}
// Fluted (reeded) panel heightmap: n rounded reeds per tile across u → normal map for walnut panelling / glass.
function flutedH(n = 8, size = 256) {
  return pixels(size, (u) => { const f = (u * n) % 1, hgt = Math.sqrt(Math.max(0, 1 - Math.pow(f * 2 - 1, 2))); const g = 30 + hgt * 220; return [g, g, g]; });
}


// ---------------------------------------------------------------- texture cache (generation is deterministic)
// Every generator above is memoised by name + arguments (canvas arguments by their cache tag). The page can be
// handed the results ahead of time — generated off the main thread by ./tex-worker.js (OffscreenCanvas) and kept in
// IndexedDB for returning visitors — so getMaterials() only copies finished pixels instead of computing them.
// The pixels are identical either way: the look does not change.
const TEXMEM = new Map();     // key → live result (canvas, or object of canvases)
const TEXSTORE = new Map();   // key → [[path, ImageBitmap]] (prewarmed, not yet restored)
let TEXREC = null;            // Set of keys touched while recording (worker)
const isCanvas = v => !!v && typeof v === 'object' && typeof v.getContext === 'function' && typeof v.width === 'number';
function texKey(name, args) {
  let ok = true;
  const k = name + JSON.stringify(args, (_, v) => { if (isCanvas(v)) { if (!v.__tk) ok = false; return '§' + v.__tk; } return v; });
  return ok ? k : null;
}
function texParts(res, pre = '', out = []) {   // [[path, canvas]] — the canvas itself ('') and canvas-valued props
  if (isCanvas(res)) out.push([pre, res]);
  if (res && typeof res === 'object') for (const [k, v] of Object.entries(res)) if (k !== '__tk' && isCanvas(v)) texParts(v, pre ? pre + '.' + k : k, out);
  return out;
}
function texTag(res, key) { for (const [p, c] of texParts(res)) c.__tk = p ? key + '/' + p : key; return res; }
function texRestore(key, parts) {
  const byPath = new Map(parts.map(([p, bm]) => {
    const c = canvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); return [p, c];
  }));
  let root = byPath.get('') || {};
  for (const [p, c] of [...byPath].filter(([p]) => p).sort((a, b) => a[0].length - b[0].length)) {
    const ks = p.split('.'); let o = root; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = c;
  }
  for (const [, bm] of parts) try { bm.close(); } catch { /* */ }
  return texTag(root, key);
}
function memoTex(name, fn) {
  return function (...args) {
    const key = texKey(name, args);
    if (!key) return fn.apply(this, args);
    if (TEXREC) TEXREC.add(key);
    let r = TEXMEM.get(key);
    if (r) return r;
    const st = TEXSTORE.get(key);
    if (st) { TEXSTORE.delete(key); try { r = texRestore(key, st); } catch (e) { r = null; } }
    if (!r) r = texTag(fn.apply(this, args), key);
    TEXMEM.set(key, r);
    return r;
  };
}
herringbone = memoTex('herringbone', herringbone); widePlanks = memoTex('widePlanks', widePlanks);
stoneTex = memoTex('stoneTex', stoneTex); marbleTex = memoTex('marbleTex', marbleTex); woodTile = memoTex('woodTile', woodTile);
tileTex = memoTex('tileTex', tileTex); fabricTex = memoTex('fabricTex', fabricTex); weaveHeight = memoTex('weaveHeight', weaveHeight);
fxAtlas = memoTex('fxAtlas', fxAtlas); bloomTex = memoTex('bloomTex', bloomTex); plasterTex = memoTex('plasterTex', plasterTex);
limewashTex = memoTex('limewashTex', limewashTex); caneTex = memoTex('caneTex', caneTex); rattanWeave = memoTex('rattanWeave', rattanWeave);
rugTex = memoTex('rugTex', rugTex); artTex = memoTex('artTex', artTex); leafTex = memoTex('leafTex', leafTex);
paperBooksTex = memoTex('paperBooksTex', paperBooksTex); normalFromHeight = memoTex('normalFromHeight', normalFromHeight);
chevron = memoTex('chevron', chevron); cabochonTex = memoTex('cabochonTex', cabochonTex);
checkerMarble = memoTex('checkerMarble', checkerMarble); washiTex = memoTex('washiTex', washiTex); flutedH = memoTex('flutedH', flutedH);

/** Worker side: generate every texture of a style; returns [[key, [[path, canvas]]]] for all keys the style uses. */
export function generateStyleTextures(styleId = 'milano') {
  TEXREC = new Set();
  try { cache.delete(styleId); getMaterials(styleId); } finally { cache.delete(styleId); }
  const keys = [...TEXREC]; TEXREC = null;
  return keys.map(k => [k, texParts(TEXMEM.get(k))]);
}
/** Page side: hand over pre-generated textures ([[key, [[path, ImageBitmap]]]]); unknown keys are ignored later. */
export function adoptTextures(entries) {
  let n = 0;
  for (const [k, parts] of entries || []) if (!TEXMEM.has(k) && !TEXSTORE.has(k)) { TEXSTORE.set(k, parts); n++; }
  return n;
}
export function hasMaterials(styleId) { return cache.has(styleId); }

// Pre-warm: textures of a style arrive from the worker (or IndexedDB) without blocking the page. Resolves (never
// rejects) once they are adopted, or at once when workers / OffscreenCanvas are unavailable — getMaterials() then
// generates on the main thread as before.
const _prewarm = new Map();
let _worker = null, _wseq = 0;
const _wwait = new Map();
function texWorker() {
  if (_worker !== null) return _worker;
  _worker = false;
  try {
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return false;
    const oc = new OffscreenCanvas(1, 1); if (!oc.getContext('2d')) return false;
    _worker = new Worker(new URL('./tex-worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = ({ data }) => { const w = _wwait.get(data.id); if (w) { _wwait.delete(data.id); w(data); } };
    _worker.onerror = e => { e.preventDefault && e.preventDefault(); for (const w of _wwait.values()) w({ error: 'worker' }); _wwait.clear(); try { _worker.terminate(); } catch { /* */ } _worker = false; };
  } catch (e) { _worker = false; }
  return _worker;
}
// cacheOnly: generate + store in IndexedDB without handing the pixels to the page (for designs not needed yet).
export function prewarmTextures(styleId = 'milano', { cacheOnly = false } = {}) {
  if (!STYLES.find(s => s.id === styleId)) styleId = 'milano';
  if (cache.has(styleId)) return Promise.resolve(true);
  if (_prewarm.has(styleId)) return _prewarm.get(styleId);
  const w = texWorker();
  if (!w) return Promise.resolve(false);
  if (cacheOnly) {
    return new Promise(res => {
      const id = ++_wseq; _wwait.set(id, data => res(!!(data && data.cached)));
      w.postMessage({ id, styleId, cacheOnly: true, src: new URL('./materials.js', import.meta.url).href, three: new URL('../../vendor/three.module.min.js', import.meta.url).href });
    });
  }
  try { performance.mark('walk:tex-request'); } catch { /* */ }
  const p = new Promise(res => {
    const id = ++_wseq;
    _wwait.set(id, data => {
      try { performance.mark('walk:tex-arrived'); } catch { /* */ }
      if (data && data.entries) { adoptTextures(data.entries); res(true); } else { _prewarm.delete(styleId); res(false); }
    });
    w.postMessage({ id, styleId, src: new URL('./materials.js', import.meta.url).href, three: new URL('../../vendor/three.module.min.js', import.meta.url).href });
  });
  _prewarm.set(styleId, p);
  return p;
}

// ---------------------------------------------------------------- materials
const cache = new Map();
const std = (o) => new THREE.MeshStandardMaterial(o);
const phys = (o) => new THREE.MeshPhysicalMaterial(o);

// ---------------------------------------------------------------- live TV picture
// One shared 320×180 canvas: a Ukrainian-language information channel of the complex — the fictional "VILNYI TV"
// (studio and anchor, an over-the-shoulder topic card, a "НОВИНИ" lower third with rotating headlines, a crawl, the
// visitor's local time, a "НАЖИВО" bug, and cuts to a weather map of Ukraine and to a dusk city skyline). The headlines
// are timeless facts about the complex (address, buildings, amenities, sales office) — no dates, no prices, no events.
// This module has no data imports (the texture worker loads it from a blob), so those facts are written out here:
// keep them in step with js/data.js PROJECT when the address or the contacts change.
// Everything is drawn here; the three backdrops and the crawl are painted once into off-screen layers, so a frame is a
// few blits and short texts. tickTv() redraws at ≤ 15 fps and is called from the screens' onBeforeRender, so the
// picture only costs anything while a switched-on screen is drawn.
let TV = null;
function tvTexture() {
  if (TV) return TV.tex;
  let c = null;
  try { c = tvCanvas(320, 180); } catch { c = null; }
  if (!c) return null;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  TV = { c, ctx: c.getContext('2d'), tex: t, last: -1e9, L: {} };
  try { drawTv(0); } catch { /* no 2d context */ }
  return t;
}
function tvCanvas(w, h) { if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } return new OffscreenCanvas(w, h); }
const TVF = (px, w = 700) => `${w} ${px}px "Helvetica Neue", Arial, "Liberation Sans", sans-serif`;
// typical daily highs in Uzhhorod by month (rounded climate normals, not a forecast): the map follows the visitor's calendar
const TV_HIGH = [2, 5, 11, 17, 22, 25, 27, 27, 22, 16, 9, 3];
const tvHigh = () => TV_HIGH[new Date().getMonth()];
// [topic, headline] — timeless facts about the complex and its address; index 0 belongs to the map cut, index 2 to the skyline cut
const tvNews = () => [
  ['ПОГОДА', `Ужгород: типовий максимум місяця — близько ${tvHigh()}°C`],
  ['АДРЕСА', 'ЖК VILNYI: вулиця Михайла Грушевського, 4А, Ужгород'],
  ['МІСТО', 'Район «Новий»: ріг вулиць Грушевського та Заньковецької'],
  ['КОМПЛЕКС', 'Чотири будинки зі спільним двором і підземним паркінгом'],
  ['ЗРУЧНОСТІ', 'Фітнес і басейн VILNYI SPA, супермаркет і дитячий простір у комплексі'],
  ['БУДІВНИЦТВО', 'Монолітний каркас, керамічний блок, автономне опалення, стелі 2,8 м'],
  ['КОНТАКТИ', 'Відділ продажу: вул. Грушевського, 23. Телефон:\u00a0+38\u00a0050\u00a0010\u00a007\u00a023'],
];
const TV_CRAWL = 'ЖК VILNYI: вул. Михайла Грушевського, 4А, Ужгород   •   ЧОТИРИ БУДИНКИ: 16, 6, 17 і 10 поверхів   •   ЗРУЧНОСТІ: фітнес і басейн VILNYI SPA, супермаркет, дитячий простір   •   ПАРКІНГ: підземний, з укриттям   •   БУДІВНИЦТВО: монолітний каркас, автономне опалення, генератор   •   ВІДДІЛ ПРОДАЖУ: вул. Грушевського, 23 · +38 050 010 07 23 · vilnyi.group   •   ';
// Ukraine's outline and cities as [lon, lat] (stylised, clockwise from the Zakarpattia corner)
const UA = [[22.15, 48.4], [22.6, 49.05], [22.7, 49.55], [23.7, 50.4], [24.1, 50.85], [23.6, 51.5], [24.3, 51.9], [25.8, 51.93], [27.8, 51.6], [29.2, 51.6], [30.55, 51.3], [30.6, 51.9], [31.8, 52.1], [33.2, 52.37], [33.8, 52.35], [34.4, 51.75], [35.1, 51.2], [35.4, 50.6], [36.3, 50.3], [37.5, 50.35], [38.0, 49.9], [39.2, 49.85], [40.15, 49.6], [39.8, 48.85], [39.9, 48.3], [39.7, 47.85], [38.85, 47.85], [38.2, 47.1], [37.5, 47.05], [36.75, 46.75], [35.3, 46.3], [34.8, 46.15], [35.0, 45.65], [36.6, 45.4], [36.4, 45.05], [35.4, 45.0], [34.4, 44.5], [33.7, 44.4], [33.4, 44.6], [33.6, 45.2], [32.5, 45.4], [33.6, 45.95], [33.5, 46.1], [32.6, 46.1], [31.9, 46.3], [31.9, 46.65], [31.2, 46.6], [30.75, 46.4], [30.3, 45.9], [29.75, 45.3], [28.2, 45.45], [28.95, 46.0], [29.6, 46.4], [30.1, 46.4], [29.9, 46.8], [29.6, 47.35], [29.2, 47.45], [29.15, 47.95], [28.0, 48.35], [27.5, 48.45], [26.65, 48.25], [26.2, 47.98], [24.9, 47.72], [24.5, 47.95], [23.2, 48.0], [22.9, 47.95], [22.3, 48.25]];
// [name, lon, lat, °C against Uzhhorod (rounded), icon (0 sun, 1 sun & cloud, 2 cloud), label side]
const UA_CITY = [['Ужгород', 22.29, 48.62, 0, 0, 1], ['Львів', 24.03, 49.84, -2, 1, 1], ['Київ', 30.52, 50.45, -2, 1, -1], ['Одеса', 30.73, 46.48, 0, 0, -1], ['Харків', 36.23, 49.99, -2, 2, 1], ['Дніпро', 35.05, 48.46, -1, 0, 1]];
function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function tvIcon(x, kind, cx, cy, s) {          // small weather / topic pictograms
  const sun = (a, b, r) => { x.fillStyle = '#ffd35a'; x.beginPath(); x.arc(a, b, r, 0, 6.3); x.fill(); x.strokeStyle = '#ffd35a'; x.lineWidth = Math.max(1, r * 0.3); for (let i = 0; i < 8; i++) { const q = i * 0.785; x.beginPath(); x.moveTo(a + Math.cos(q) * r * 1.4, b + Math.sin(q) * r * 1.4); x.lineTo(a + Math.cos(q) * r * 1.9, b + Math.sin(q) * r * 1.9); x.stroke(); } };
  const cloud = (a, b, r, col = '#eef3f8') => { x.fillStyle = col; x.beginPath(); x.arc(a - r * 0.8, b, r * 0.7, 0, 6.3); x.arc(a, b - r * 0.45, r, 0, 6.3); x.arc(a + r * 0.9, b, r * 0.75, 0, 6.3); x.fill(); x.fillRect(a - r * 0.8, b - r * 0.1, r * 1.7, r * 0.8); };
  const towers = () => { x.fillStyle = '#eef3f8'; x.fillRect(cx - s * 0.62, cy - s * 0.2, s * 0.5, s * 0.8); x.fillRect(cx - s * 0.02, cy - s * 0.62, s * 0.62, s * 1.22); x.fillStyle = '#d8b46a'; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) x.fillRect(cx + s * (0.08 + j * 0.27), cy - s * (0.5 - i * 0.27), s * 0.15, s * 0.14); };
  if (kind === 0 || kind === 'ПОГОДА') sun(cx, cy, s * 0.42);
  else if (kind === 1) { sun(cx + s * 0.25, cy - s * 0.2, s * 0.3); cloud(cx - s * 0.1, cy + s * 0.15, s * 0.36); }
  else if (kind === 2) cloud(cx, cy, s * 0.45, '#cfd8e2');
  else if (kind === 'АДРЕСА') {                 // map pin
    x.fillStyle = '#eef3f8'; x.beginPath(); x.arc(cx, cy - s * 0.18, s * 0.46, Math.PI * 0.85, Math.PI * 0.15); x.lineTo(cx, cy + s * 0.68); x.closePath(); x.fill();
    x.fillStyle = '#c8202a'; x.beginPath(); x.arc(cx, cy - s * 0.18, s * 0.19, 0, 6.3); x.fill();
  } else if (kind === 'МІСТО') {                // a street of low houses with pitched roofs
    x.fillStyle = '#eef3f8';
    for (const [q, w, h] of [[-0.78, 0.48, 0.5], [-0.24, 0.5, 0.74], [0.32, 0.46, 0.42]]) { x.fillRect(cx + s * q, cy + s * (0.6 - h), s * w, s * h); x.beginPath(); x.moveTo(cx + s * (q - 0.05), cy + s * (0.6 - h)); x.lineTo(cx + s * (q + w / 2), cy + s * (0.28 - h)); x.lineTo(cx + s * (q + w + 0.05), cy + s * (0.6 - h)); x.closePath(); x.fill(); }
    x.fillStyle = '#d8b46a'; for (const q of [-0.62, -0.08, 0.47]) x.fillRect(cx + s * q, cy + s * 0.28, s * 0.16, s * 0.16);
  } else if (kind === 'КОМПЛЕКС') towers();
  else if (kind === 'ЗРУЧНОСТІ') {              // pool: three wave lines under a lane rope
    x.strokeStyle = '#8fc3e6'; x.lineWidth = Math.max(1, s * 0.13); x.lineCap = 'round';
    for (let r = 0; r < 3; r++) { const y = cy - s * 0.1 + r * s * 0.3; x.beginPath(); x.moveTo(cx - s * 0.8, y); for (let i = 0; i < 4; i++) x.quadraticCurveTo(cx - s * 0.8 + (i + 0.5) * s * 0.4, y + (i % 2 ? s * 0.16 : -s * 0.16), cx - s * 0.8 + (i + 1) * s * 0.4, y); x.stroke(); }
    x.fillStyle = '#eef3f8'; x.beginPath(); x.arc(cx + s * 0.2, cy - s * 0.48, s * 0.17, 0, 6.3); x.fill(); x.lineWidth = Math.max(1, s * 0.12); x.strokeStyle = '#eef3f8'; x.beginPath(); x.moveTo(cx - s * 0.55, cy - s * 0.3); x.lineTo(cx - s * 0.05, cy - s * 0.42); x.stroke();
  } else if (kind === 'БУДІВНИЦТВО') {          // tower crane beside a rising frame
    x.fillStyle = '#eef3f8'; x.fillRect(cx - s * 0.7, cy - s * 0.05, s * 0.7, s * 0.68);
    x.fillStyle = '#16233c'; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.fillRect(cx - s * (0.6 - j * 0.3), cy + s * (0.06 + i * 0.3), s * 0.2, s * 0.18);
    x.fillStyle = '#d8b46a'; x.fillRect(cx + s * 0.32, cy - s * 0.66, s * 0.1, s * 1.29); x.fillRect(cx - s * 0.5, cy - s * 0.66, s * 1.3, s * 0.09); x.fillRect(cx - s * 0.32, cy - s * 0.6, s * 0.04, s * 0.32);
  } else if (kind === 'КОНТАКТИ') {             // handset
    x.strokeStyle = '#eef3f8'; x.lineWidth = Math.max(1.5, s * 0.24); x.lineCap = 'round'; x.beginPath(); x.arc(cx + s * 0.34, cy - s * 0.34, s * 0.78, Math.PI * 0.56, Math.PI * 0.94); x.stroke();
    x.lineWidth = Math.max(2, s * 0.4); x.beginPath(); x.arc(cx + s * 0.34, cy - s * 0.34, s * 0.78, Math.PI * 0.5, Math.PI * 0.6); x.stroke(); x.beginPath(); x.arc(cx + s * 0.34, cy - s * 0.34, s * 0.78, Math.PI * 0.9, Math.PI); x.stroke();
  } else towers();
}
// the channel bug: gold origami bird + "VILNYI TV"
function tvLogo(x, a, b, k = 1) {
  x.save(); x.translate(a, b); x.scale(k, k);
  x.fillStyle = 'rgba(8,14,30,0.72)'; rr(x, 0, 0, 68, 15, 3); x.fill();
  x.fillStyle = '#d8b46a'; x.beginPath(); x.moveTo(4, 8.5); x.lineTo(13, 3); x.lineTo(10.5, 8); x.lineTo(16, 7.5); x.lineTo(8.5, 12.5); x.closePath(); x.fill();
  x.font = TVF(8.5, 800); x.textBaseline = 'middle'; x.textAlign = 'left'; x.fillText('VILNYI', 19, 8, 30);
  x.fillStyle = '#c8202a'; rr(x, 52, 2.5, 13, 10, 2); x.fill();
  x.fillStyle = '#fff'; x.font = TVF(6.5, 800); x.textAlign = 'center'; x.fillText('TV', 58.5, 8, 11);
  x.restore();
}
function tvLayer(key, w, h, paint) { let c = TV.L[key]; if (!c) { c = TV.L[key] = tvCanvas(w, h); paint(c.getContext('2d')); } return c; }
const W_TV = 320, H_TV = 180;
function tvStudio() {
  return tvLayer('studio', W_TV, H_TV, (x) => {
    const W = W_TV, H = H_TV;
    let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a1c44'); g.addColorStop(0.6, '#123a78'); g.addColorStop(1, '#071230');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // video wall: tall panels with a dotted world band and soft light bars
    for (let i = 0; i < 6; i++) { const px = -10 + i * 58; g = x.createLinearGradient(px, 0, px + 54, 0); g.addColorStop(0, 'rgba(70,140,230,0.10)'); g.addColorStop(0.5, 'rgba(110,180,255,0.32)'); g.addColorStop(1, 'rgba(70,140,230,0.10)'); x.fillStyle = g; x.fillRect(px, 6, 54, 112); }
    x.fillStyle = 'rgba(170,215,255,0.35)';
    for (let i = 0; i < 64; i++) for (let j = 0; j < 14; j++) { const n = Math.sin(i * 0.31 + 1) * Math.cos(j * 0.52 + i * 0.07) + Math.sin(i * 0.11 + j * 0.3); if (n > 0.35) x.fillRect(4 + i * 5, 34 + j * 5, 2, 2); }
    x.strokeStyle = 'rgba(216,180,106,0.55)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, 26); x.lineTo(W, 26); x.moveTo(0, 110); x.lineTo(W, 110); x.stroke();
    g = x.createRadialGradient(108, 60, 6, 108, 60, 120); g.addColorStop(0, 'rgba(160,210,255,0.38)'); g.addColorStop(1, 'rgba(160,210,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    // desk: light top, dark front with a gold line
    g = x.createLinearGradient(0, 118, 0, 150); g.addColorStop(0, '#e9eef6'); g.addColorStop(0.16, '#b9c6da'); g.addColorStop(0.2, '#101c3a'); g.addColorStop(1, '#060c1e');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, 124); x.quadraticCurveTo(W / 2, 112, W, 124); x.lineTo(W, H); x.lineTo(0, H); x.closePath(); x.fill();
    x.strokeStyle = '#d8b46a'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 133); x.quadraticCurveTo(W / 2, 121, W, 133); x.stroke();
  });
}
function tvMap() {
  return tvLayer('map', W_TV, H_TV, (x) => {
    const W = W_TV, H = H_TV, P = ([lo, la]) => [98 + (lo - 22.0) * 10.6, 12 + (52.5 - la) * 15.2];
    let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b2a5c'); g.addColorStop(1, '#06132e'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(140,190,255,0.12)'; x.lineWidth = 1; for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(0, i * 22 + 4); x.lineTo(W, i * 22 + 4); x.stroke(); x.beginPath(); x.moveTo(i * 40, 0); x.lineTo(i * 40, H); x.stroke(); }
    x.beginPath(); UA.forEach((p, i) => { const [a, b] = P(p); if (i) x.lineTo(a, b); else x.moveTo(a, b); }); x.closePath();
    g = x.createLinearGradient(0, 20, 0, 140); g.addColorStop(0, '#3f8f5e'); g.addColorStop(0.5, '#5aa56a'); g.addColorStop(1, '#8fb86a');
    x.fillStyle = g; x.fill(); x.strokeStyle = '#eaf4ff'; x.lineWidth = 1.5; x.lineJoin = 'round'; x.stroke();
    // the Carpathian arc, the Dnipro and the Black Sea
    x.strokeStyle = 'rgba(40,80,50,0.55)'; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.moveTo(...P([22.75, 48.85])); x.quadraticCurveTo(...P([24.0, 48.35]), ...P([25.3, 47.95])); x.stroke();
    x.strokeStyle = 'rgba(120,190,240,0.75)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(...P([30.55, 51.3])); x.quadraticCurveTo(...P([30.4, 50.2]), ...P([32.0, 49.3])); x.quadraticCurveTo(...P([34.6, 48.6]), ...P([35.1, 47.8])); x.quadraticCurveTo(...P([34.2, 47.2]), ...P([32.6, 46.5])); x.stroke();
    x.fillStyle = 'rgba(120,190,240,0.9)'; x.font = TVF(7, 600); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Чорне море', ...P([30.0, 44.85]));
    x.textAlign = 'left'; x.fillStyle = '#fff'; x.font = TVF(11, 800); x.fillText('ПОГОДА', 10, 40);
    x.fillStyle = '#d8b46a'; x.fillRect(10, 48, 60, 1.5);
    x.fillStyle = 'rgba(200,225,255,0.9)'; x.font = TVF(8, 600); x.fillText('Україна', 10, 57); x.font = TVF(6.5, 600); x.fillText('типові максимуми', 10, 67); x.fillText('місяця', 10, 75);
    const hi = tvHigh();
    for (const [name, lo, la, dt, ic, side] of UA_CITY) {
      const [a, b] = P([lo, la]);
      x.fillStyle = '#fff'; x.beginPath(); x.arc(a, b, 2, 0, 6.3); x.fill();
      tvIcon(x, ic, a - side * 9, b - 8, 8);
      x.font = TVF(8, 700); x.textAlign = side < 0 ? 'right' : 'left'; x.lineWidth = 2.4; x.lineJoin = 'round'; x.strokeStyle = 'rgba(6,19,46,0.9)';
      const lab = `${name} ${hi + dt}°`; x.strokeText(lab, a + side * 5, b + 1); x.fillStyle = '#fff'; x.fillText(lab, a + side * 5, b + 1);
    }
  });
}
function tvSkyline() {
  return tvLayer('sky', W_TV, H_TV, (x) => {
    const W = W_TV, H = H_TV, hz = 104;
    let g = x.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, '#27365f'); g.addColorStop(0.6, '#b0627a'); g.addColorStop(1, '#f6b678'); x.fillStyle = g; x.fillRect(0, 0, W, hz);
    g = x.createRadialGradient(214, hz - 6, 2, 214, hz - 6, 80); g.addColorStop(0, 'rgba(255,230,180,0.95)'); g.addColorStop(0.15, 'rgba(255,200,140,0.5)'); g.addColorStop(1, 'rgba(255,200,140,0)'); x.fillStyle = g; x.fillRect(0, 0, W, hz);
    // far hills, the far city, then the nearer blocks (lit windows) and a line of trees
    x.fillStyle = 'rgba(84,70,112,0.6)'; x.beginPath(); x.moveTo(0, hz); for (let i = 0; i <= 32; i++) x.lineTo(i * 10, hz - 30 - 9 * Math.sin(i * 0.37 + 0.6) - 5 * Math.sin(i * 0.93 + 2)); x.lineTo(W, hz); x.closePath(); x.fill();
    x.fillStyle = 'rgba(60,58,96,0.75)'; for (let i = 0; i < 40; i++) { const h = 8 + ((i * 37) % 17); x.fillRect(i * 8.2, hz - h, 7, h); }
    for (let i = 0; i < 17; i++) {
      const bw = 13 + (i * 7) % 9, bx = i * 19.5 - 4, h = 20 + ((i * 53) % 30) + (i % 5 === 2 ? 14 : 0);
      x.fillStyle = '#1c1f38'; x.fillRect(bx, hz - h, bw, h);
      x.fillStyle = 'rgba(255,214,140,0.85)'; for (let a = 2; a < bw - 2; a += 3) for (let b = 3; b < h - 2; b += 4) if ((a * 7 + b * 13 + i * 5) % 5 < 2) x.fillRect(bx + a, hz - h + b, 1.4, 1.6);
    }
    x.fillStyle = '#141a2c'; for (let i = 0; i < 26; i++) { const tx = i * 13 + (i * 5) % 7; x.beginPath(); x.arc(tx, hz - 1, 4 + (i % 3), Math.PI, 0); x.fill(); }
    g = x.createLinearGradient(0, hz, 0, H); g.addColorStop(0, '#1a2036'); g.addColorStop(1, '#0c1226'); x.fillStyle = g; x.fillRect(0, hz, W, H - hz);
  });
}
function tvCrawl() {
  if (!TV.L.crawl) {
    const m = TV.ctx; m.font = TVF(9, 600); const w = Math.ceil(m.measureText(TV_CRAWL).width);
    const c = TV.L.crawl = tvCanvas(w, 14), x = c.getContext('2d');
    x.font = TVF(9, 600); x.textBaseline = 'middle'; x.fillStyle = '#f2f5fa'; x.fillText(TV_CRAWL, 0, 7.5);
  }
  return TV.L.crawl;
}
// headline wrapped to two lines (cached per headline)
function tvLines(x, text, maxW) {
  const k = 'h:' + text; if (TV.L[k]) return TV.L[k];
  const words = text.split(' '), lines = ['']; x.font = TVF(10.5, 700);
  for (const w of words) { const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w; if (x.measureText(t).width > maxW && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t; }
  return (TV.L[k] = lines.slice(0, 2));
}
// programme: [duration s, scene]; headlines change every 7 s
const TV_PROG = [[28, 'studio'], [12, 'map'], [21, 'studio'], [11, 'sky']], TV_LOOP = TV_PROG.reduce((a, p) => a + p[0], 0);
function drawTv(T) {
  const { ctx: x } = TV, W = W_TV, H = H_TV, news = TV.news || (TV.news = tvNews());
  let tt = T % TV_LOOP, scene = 'studio', ts = 0;
  for (const [d, s] of TV_PROG) { if (tt < d) { scene = s; ts = tt; break; } tt -= d; }
  let hi = Math.floor(T / 7) % news.length;
  if (scene === 'map') hi = 0; else if (scene === 'sky') hi = 2;     // the cut-aways carry their own headline
  const [topic, head] = news[hi];
  x.globalAlpha = 1; x.textAlign = 'left';
  if (scene === 'studio') {
    x.drawImage(tvStudio(), 0, 0);
    // light sweeping across the video wall
    const sw = ((T * 26) % (W + 160)) - 80; let g = x.createLinearGradient(sw - 40, 0, sw + 40, 0); g.addColorStop(0, 'rgba(150,200,255,0)'); g.addColorStop(0.5, 'rgba(150,200,255,0.16)'); g.addColorStop(1, 'rgba(150,200,255,0)'); x.fillStyle = g; x.fillRect(sw - 40, 6, 80, 104);
    // anchor: a generic figure — suit, shirt, head; it nods and talks
    const ax = 108, bob = Math.sin(T * 1.7) * 0.7 + Math.sin(T * 4.3) * 0.3, sway = Math.sin(T * 0.6) * 1.2, talk = 0.5 + 0.5 * Math.sin(T * 13) * Math.sin(T * 3.1);
    x.fillStyle = '#16233c'; x.beginPath(); x.moveTo(ax - 44 + sway * 0.3, 128); x.quadraticCurveTo(ax - 40 + sway, 84, ax - 12 + sway, 78); x.lineTo(ax + 12 + sway, 78); x.quadraticCurveTo(ax + 40 + sway, 84, ax + 44 + sway * 0.3, 128); x.closePath(); x.fill();
    x.fillStyle = '#f1f3f7'; x.beginPath(); x.moveTo(ax - 8 + sway, 78); x.lineTo(ax + sway, 100); x.lineTo(ax + 8 + sway, 78); x.closePath(); x.fill();
    x.fillStyle = '#b8323a'; x.beginPath(); x.moveTo(ax - 2 + sway, 82); x.lineTo(ax + 2 + sway, 82); x.lineTo(ax + 3 + sway, 98); x.lineTo(ax + sway, 102); x.lineTo(ax - 3 + sway, 98); x.closePath(); x.fill();
    const hx = ax + sway, hy = 60 + bob;
    x.fillStyle = '#d9ab8c'; x.fillRect(hx - 5, hy + 10, 10, 10);
    x.beginPath(); x.ellipse(hx, hy, 11.5, 14.5, 0, 0, 6.3); x.fillStyle = '#e6bc9e'; x.fill();
    x.fillStyle = '#3a2a22'; x.beginPath(); x.ellipse(hx, hy - 5.5, 12.3, 10.5, 0, Math.PI, 0); x.fill(); x.fillRect(hx - 12.3, hy - 6, 3, 8); x.fillRect(hx + 9.3, hy - 6, 3, 8);
    x.fillStyle = '#2a2420'; x.fillRect(hx - 5.5, hy - 0.5, 2.6, 1.6); x.fillRect(hx + 2.9, hy - 0.5, 2.6, 1.6);
    x.fillStyle = '#8c4a44'; x.fillRect(hx - 2.6, hy + 7, 5.2, 0.9 + talk * 2.2);
    // over-the-shoulder card for the current topic
    x.fillStyle = 'rgba(8,16,38,0.78)'; rr(x, 196, 30, 104, 72, 4); x.fill(); x.strokeStyle = '#d8b46a'; x.lineWidth = 1; x.stroke();
    g = x.createLinearGradient(196, 30, 300, 102); g.addColorStop(0, 'rgba(70,130,220,0.5)'); g.addColorStop(1, 'rgba(30,60,130,0.2)'); x.fillStyle = g; rr(x, 199, 33, 98, 48, 3); x.fill();
    tvIcon(x, topic, 248, 57, 20);
    x.fillStyle = '#fff'; x.font = TVF(9.5, 800); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(topic, 248, 92, 96); x.textAlign = 'left';
  } else if (scene === 'map') {
    x.drawImage(tvMap(), 0, 0);
    // a band of cloud drifting over the map
    for (let i = 0; i < 3; i++) { const cx = ((T * (5 + i * 2) + i * 130) % (W + 120)) - 60, cy = 44 + i * 24; const g = x.createRadialGradient(cx, cy, 2, cx, cy, 34); g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(cx - 34, cy - 20, 68, 40); }
  } else {
    x.drawImage(tvSkyline(), 0, 0);
    // dusk over the city: thin clouds drifting across the glow, a few windows switching on and off
    for (let i = 0; i < 4; i++) { const cw = 70 + i * 16, cx = ((T * (3 + i * 1.5) + i * 97) % (W + cw * 2)) - cw, cy = 30 + i * 12; const g = x.createRadialGradient(cx, cy, 2, cx, cy, cw / 2); g.addColorStop(0, 'rgba(255,214,190,0.22)'); g.addColorStop(1, 'rgba(255,214,190,0)'); x.fillStyle = g; x.fillRect(cx - cw / 2, cy - 9, cw, 18); }
    for (let i = 0; i < 12; i++) { const a = 0.5 + 0.5 * Math.sin(T * (0.5 + (i % 4) * 0.21) + i * 2.3); x.fillStyle = `rgba(255,224,160,${0.15 + 0.75 * a})`; x.fillRect(6 + ((i * 53) % 300), 82 + ((i * 29) % 18), 1.6, 1.8); }
    x.fillStyle = 'rgba(8,14,30,0.6)'; rr(x, 8, 26, 116, 14, 3); x.fill(); x.fillStyle = '#fff'; x.font = TVF(8, 700); x.textBaseline = 'middle'; x.fillText('УЖГОРОД · ЗАКАРПАТТЯ', 13, 33.5, 106);
  }
  // cut between scenes: a quick gold-edged wipe
  if (ts < 0.45) { const k = ts / 0.45, wx = k * (W + 60) - 30; x.fillStyle = '#0a1a40'; x.fillRect(wx, 0, W, H); x.fillStyle = '#d8b46a'; x.fillRect(wx - 3, 0, 3, H); }
  // lower third: red "НОВИНИ" tab + topic, headline on a light bar
  // (the weather map keeps a single slim line, so the south of the country stays in view)
  const map = scene === 'map', ly = map ? 148 : 119, hs = Math.min(1, ((T % 7) / 0.35)), lines = tvLines(x, head, 284);
  x.fillStyle = '#c8202a'; x.fillRect(8, ly, 46, 13); x.fillStyle = '#fff'; x.font = TVF(8.5, 800); x.textBaseline = 'middle'; x.fillText('НОВИНИ', 12, ly + 7, 38);
  x.font = TVF(8, 700); const tabR = 54 + Math.ceil(x.measureText(topic).width) + 12;
  x.fillStyle = '#0d1f47'; x.fillRect(54, ly, tabR - 54, 13); x.fillStyle = '#ffd98a'; x.fillText(topic, 60, ly + 7);
  if (map) { x.fillStyle = 'rgba(244,246,250,0.96)'; x.fillRect(tabR, ly, 312 - tabR, 13); x.fillStyle = '#0c1836'; x.font = TVF(8, 700); x.fillText(head, tabR + 5, ly + 7, 302 - tabR); }
  else {
    x.fillStyle = 'rgba(244,246,250,0.96)'; x.fillRect(8, ly + 13, 304, 29); x.fillStyle = '#c8202a'; x.fillRect(8, ly + 13, 3, 29);
    x.save(); x.beginPath(); x.rect(11, ly + 13, 301, 29); x.clip(); x.globalAlpha = hs; x.fillStyle = '#0c1836'; x.font = TVF(10.5, 700);
    lines.forEach((l, i) => x.fillText(l, 16, ly + (lines.length === 1 ? 28 : 21.5 + i * 12.5) + (1 - hs) * 6)); x.restore();
  }
  // crawl + local clock
  x.fillStyle = '#081430'; x.fillRect(0, 163, W, 17);
  const cr = tvCrawl(), off = (T * 30) % cr.width; x.drawImage(cr, 44 - off, 164.5); if (cr.width - off < W) x.drawImage(cr, 44 - off + cr.width, 164.5);
  const now = new Date(), hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
  x.fillStyle = '#d8b46a'; x.fillRect(0, 163, 42, 17); x.fillStyle = '#0a1228'; x.font = TVF(10.5, 800); x.textAlign = 'center'; x.fillText(hh + (now.getSeconds() % 2 ? ':' : ' ') + mm, 21, 172); x.textAlign = 'left';
  // "НАЖИВО" bug + channel logo
  x.fillStyle = 'rgba(8,14,30,0.72)'; rr(x, 8, 7, 54, 14, 3); x.fill();
  x.fillStyle = `rgba(232,50,44,${0.55 + 0.45 * (Math.sin(T * 4) > 0 ? 1 : 0.3)})`; x.beginPath(); x.arc(16, 14, 3, 0, 6.3); x.fill();
  x.fillStyle = '#fff'; x.font = TVF(8, 800); x.fillText('НАЖИВО', 22, 14.5);
  tvLogo(x, W - 76, 7);
}
// Advance the TV picture (throttled to ~15 fps). Screens call it from onBeforeRender.
export function tickTv(now = performance.now()) {
  if (!TV || now - TV.last < 66) return;
  TV.last = now;
  try { drawTv(now / 1000); TV.tex.needsUpdate = true; } catch { /* canvas unavailable */ }
}

export function getMaterials(styleId = 'milano') {
  if (!STYLES.find(s => s.id === styleId)) styleId = 'milano';
  if (cache.has(styleId)) return cache.get(styleId);
  const S = STYLES.find(s => s.id === styleId);
  const m = { styleId, style: S, fam: S.family || styleId };
  const V = (o) => o[styleId] ?? o[m.fam];            // per-style value, falling back to the family's

  // shared grayscale textures (tinted per material colour) + cloth normal maps (UVs are metres → repeat = 1/tile)
  const fab = tex(fabricTex('weave', 2), { srgb: true, repeat: 3 });
  const velvet = tex(fabricTex('velvet', 4), { repeat: 2 });
  const boucle = tex(fabricTex('boucle', 6), { repeat: 5 });
  const linen = tex(fabricTex('linen', 7), { repeat: 4 });
  const plaster = tex(plasterTex(4, m.fam === 'milano' ? 0.05 : 0.035), { repeat: 0.5 });
  const lime = tex(limewashTex(8), { repeat: 0.35 });
  const nWeave = nrm(weaveHeight('weave', 3), 1.6, 1 / 0.05), nLinen = nrm(weaveHeight('linen', 5), 1.8, 1 / 0.07);
  const nBoucle = nrm(weaveHeight('boucle', 9), 3.5, 1 / 0.09), nVelvet = nrm(weaveHeight('velvet', 11), 1.2, 1 / 0.2);
  const nPlaster = nrm(plasterTex(21, 0.5, 256), 0.9, 1 / 1.3);
  const nRug = nrm(weaveHeight('boucle', 9), 3.5, 26);
  // smudge: faint low-frequency roughness drift (wipe marks, uneven sheen) for lacquer, painted walls, appliances —
  // a perfectly uniform specular lobe is one of the strongest "CG" tells
  const smudgeC = (() => { const f = fbmFn(4, 5, 77), g = fbmFn(16, 3, 79); return pixels(256, (u, v) => { const t = 150 + (f(u, v) - 0.5) * 55 + (g(u, v) - 0.5) * 18; return [t, t, t]; }); })();
  const smudge = (rep) => tex(smudgeC, { srgb: false, repeat: rep });

  // ---------- floors (colour + normal + roughness maps; tiles/planks carry their own variation)
  if (styleId === 'milano') {
    const hb = herringbone(hex('#6e4f3a'), 11), R = 1 / 0.72;
    m.floor = std({ map: tex(hb.map, { repeat: R }), normalMap: tex(hb.normal, { srgb: false, repeat: R }), normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: tex(hb.rough, { srgb: false, repeat: R }), roughness: 0.6, metalness: 0, envMapIntensity: 0.6 });
    // Nero Marquina: near-black with smoky grey clouding, crisp white veins with a grey haze, a fine crossing network
    const mb = marbleTex(1024, '#141312', '#b3ada3', { seed: 21, vein2: '#4a4540', strength: 0.6, network: 0.4, width: 0.62, levels: [0, 0.42], scale: 2, turb: 0.3, turb2: 0.45, haze: 0.4, cloud: 1.4, smoke: 0.3 });
    m.marble = phys({ map: tex(mb, { repeat: 1 / 1.6 }), roughnessMap: tex(mb.rough_, { srgb: false, repeat: 1 / 1.6 }), roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 1.0 });
    const tb = tileTex({ size: 512, tilesX: 2, tilesY: 2, colors: ['#1f1e1d'], grout: '#2c2a28', groutW: 3, surface: mb });
    m.floorBath = std({ map: tex(tb.map, { repeat: 1 / 1.2 }), normalMap: nrm(tb.bump, 1.5, 1 / 1.2), roughness: 0.22, envMapIntensity: 0.9 });
    m.wallBath = phys({ map: tex(mb, { repeat: 1 / 1.8 }), roughnessMap: tex(mb.rough_, { srgb: false, repeat: 1 / 1.8 }), roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.9 });
    m.counter = m.marble;
    const sb = marbleTex(512, '#ebe6de', '#9a9084', { seed: 33, vein2: '#cfc7bb', strength: 0.7, network: 0.4, width: 1.4, gold: 0.5, rough: 1.2 });
    m.stone = phys({ map: tex(sb, { repeat: 1 / 1.2 }), roughnessMap: tex(sb.rough_, { srgb: false, repeat: 1 / 1.2 }), roughness: 1, clearcoat: 0.5, envMapIntensity: 0.9 });
  } else if (styleId === 'nordic') {
    const wp = widePlanks(hex('#cdae83'), 12), R = 1 / 2.4;
    m.floor = std({ map: tex(wp.map, { repeat: R }), normalMap: tex(wp.normal, { srgb: false, repeat: R }), normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: tex(wp.rough, { srgb: false, repeat: R }), roughness: 0.64, envMapIntensity: 0.7 });
    // Calacatta-style: warm white, soft grey veins with a wide haze and a faint gold cast
    const mb = marbleTex(1024, '#f2f0ec', '#8f887e', { seed: 22, vein2: '#d2ccc3', strength: 0.75, network: 0.45, width: 1.5, haze: 0.55, cloud: 0.7, gold: 0.35 });
    m.marble = phys({ map: tex(mb, { repeat: 1 / 1.4 }), roughnessMap: tex(mb.rough_, { srgb: false, repeat: 1 / 1.4 }), roughness: 1, clearcoat: 0.55, clearcoatRoughness: 0.12, envMapIntensity: 0.9 });
    const tb = tileTex({ size: 512, tilesX: 8, tilesY: 8, colors: ['#d9d7d2', '#d3d1cc', '#dcdad5'], grout: '#bdbab4', groutW: 2 });
    m.floorBath = std({ map: tex(tb.map, { repeat: 1 / 1.2 }), normalMap: nrm(tb.bump, 1.5, 1 / 1.2), roughness: 0.5 });
    const wt = tileTex({ size: 512, tilesX: 4, tilesY: 16, colors: ['#f4f3f0', '#eeede9', '#f1f0ec'], grout: '#dcdad5', groutW: 2, pattern: 'brick', glaze: 0.04 });
    m.wallBath = phys({ map: tex(wt.map, { repeat: 1 / 1.2 }), normalMap: nrm(wt.bump, 2, 1 / 1.2), roughness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.8 });
    const cb = marbleTex(512, '#f3f2ef', '#aaa399', { seed: 44, vein2: '#dcd7cf', strength: 0.6, network: 0.35, width: 1.6, haze: 0.5, cloud: 0.6, rough: 1.3 });
    m.counter = phys({ map: tex(cb, { repeat: 1 / 1.2 }), roughnessMap: tex(cb.rough_, { srgb: false, repeat: 1 / 1.2 }), roughness: 1, clearcoat: 0.4 });
    m.stone = m.counter;
  } else if (styleId === 'monaco') {
    // smoked-oak herringbone (deeper and cooler than milano's walnut, finer planks)
    const hb = herringbone(hex('#3b281c'), 13), R = 1 / 0.6;
    m.floor = std({ map: tex(hb.map, { repeat: R }), normalMap: tex(hb.normal, { srgb: false, repeat: R }), normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: tex(hb.rough, { srgb: false, repeat: R }), roughness: 0.55, envMapIntensity: 0.55 });
    // Calacatta Oro: warm white, bold grey-gold veins with a wide haze; Nero Marquina for the dark accents
    const cal = marbleTex(1024, '#f4f0e8', '#8a7d6a', { seed: 41, vein2: '#d8cdbb', strength: 0.95, network: 0.5, width: 1.7, levels: [0, 0.5], scale: 1, turb: 0.45, turb2: 0.5, haze: 0.6, cloud: 0.6, gold: 0.75 });
    const nero = marbleTex(1024, '#121212', '#c9c2b6', { seed: 21, vein2: '#4a4540', strength: 0.65, network: 0.45, width: 0.6, levels: [0, 0.42], scale: 2, turb: 0.3, turb2: 0.45, haze: 0.4, cloud: 1.4, smoke: 0.3 });
    m.marble = phys({ map: tex(cal, { repeat: 1 / 1.5 }), roughnessMap: tex(cal.rough_, { srgb: false, repeat: 1 / 1.5 }), roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.06, envMapIntensity: 1.0 });
    m.marbleDark = phys({ map: tex(nero, { repeat: 1 / 1.6 }), roughnessMap: tex(nero.rough_, { srgb: false, repeat: 1 / 1.6 }), roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.06, envMapIntensity: 1.0 });
    // entrance hall: 60 cm Calacatta / Nero checkerboard with brass inlay joints
    const ck = checkerMarble(cal, nero, 2);
    m.floorHall = phys({ map: tex(ck, { repeat: 1 / 1.2 }), normalMap: nrm(ck.height_, 1.4, 1 / 1.2), roughnessMap: tex(ck.rough_, { srgb: false, repeat: 1 / 1.2 }), roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 1.0 });
    const tb = tileTex({ size: 512, tilesX: 2, tilesY: 2, colors: ['#141414'], grout: '#b8955a', groutW: 3, surface: nero });
    m.floorBath = phys({ map: tex(tb.map, { repeat: 1 / 1.2 }), normalMap: nrm(tb.bump, 1.5, 1 / 1.2), roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.1, envMapIntensity: 0.9 });
    // gold-veined bathroom: book-matched Calacatta Oro slabs floor to ceiling
    m.wallBath = phys({ map: tex(cal, { repeat: 1 / 1.6 }), roughnessMap: tex(cal.rough_, { srgb: false, repeat: 1 / 1.6 }), roughness: 1, clearcoat: 0.45, clearcoatRoughness: 0.2, envMapIntensity: 0.95 });
    m.counter = m.marbleDark;
    m.stone = m.marble;
  } else if (styleId === 'paris') {
    // point-de-Hongrie light oak (72 cm tile: two 36 cm columns of 8.5 cm planks), satin-oiled
    const ch = chevron(hex('#b88f5f'), 19), R = 1 / 0.72;
    m.floor = std({ map: tex(ch.map, { repeat: R }), normalMap: tex(ch.normal, { srgb: false, repeat: R }), normalScale: new THREE.Vector2(0.85, 0.85), roughnessMap: tex(ch.rough, { srgb: false, repeat: R }), roughness: 0.6, envMapIntensity: 0.62 });
    // Carrara: cool white ground, soft blue-grey feathered veins with a wide haze and a fine crossing network
    const car = marbleTex(1024, '#f4f6f8', '#858e98', { seed: 52, vein2: '#c3c9cf', strength: 0.52, network: 0.75, width: 0.9, levels: [0, 0.37], scale: 2, turb: 0.46, turb2: 0.5, haze: 0.85, cloud: 1.15 });
    m.marble = phys({ map: tex(car, { repeat: 1 / 1.5 }), roughnessMap: tex(car.rough_, { srgb: false, repeat: 1 / 1.5 }), roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 1.0 });
    m.wallBath = m.marble;                       // the same slab on the bath walls (one material → one draw call)
    // bath floor: black-and-white cabochon mosaic (7.5 cm octagons, black insets)
    const mo = cabochonTex(8, 1024);
    m.floorBath = phys({ map: tex(mo.map, { repeat: 1 / 0.6 }), normalMap: nrm(mo.bump, 1.3, 1 / 0.6), roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.85 });
    m.counter = m.marble;
    m.stone = m.marble;
  } else if (styleId === 'kyoto') {
    // wide, pale white-oiled oak with a quiet grain
    const wp = widePlanks(hex('#c8a77c'), 17), R = 1 / 2.4;
    m.floor = std({ map: tex(wp.map, { repeat: R }), normalMap: tex(wp.normal, { srgb: false, repeat: R }), normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: tex(wp.rough, { srgb: false, repeat: R }), roughness: 0.74, envMapIntensity: 0.45 });
    // pale honed travertine (filled pores, soft cross-cut clouds)
    const tr = stoneTex(1024, '#e8ddca', '#c6b08e', { bands: 23, pores: 0.01, seed: 27, contrast: 0.62 });
    const trN = nrm(tr.height_, 1.2, 1 / 1.4);
    m.marble = std({ map: tex(tr, { repeat: 1 / 1.4 }), normalMap: trN, roughnessMap: smudge(0.8), roughness: 0.55 / 0.59, envMapIntensity: 0.55 });
    const tt = tileTex({ size: 1024, tilesX: 1, tilesY: 2, colors: ['#d9cbb2', '#d3c4a9'], grout: '#bfae92', groutW: 3, surface: tr, glaze: 0.03 });
    const th = canvas(1024), thc = th.getContext('2d'); thc.drawImage(tt.bump, 0, 0); thc.globalCompositeOperation = 'multiply'; thc.drawImage(tr.height_, 0, 0); th.__tk = 'kyotoTravH';
    // full-strength stone with the joints of the 120 × 60 cm slabs multiplied in (the generic tile overlay is too faint)
    const tm = canvas(1024), tmc = tm.getContext('2d'); tmc.drawImage(tr, 0, 0); tmc.globalCompositeOperation = 'multiply'; tmc.globalAlpha = 0.45; tmc.drawImage(tt.bump, 0, 0); tm.__tk = 'kyotoTravMap';
    m.floorHall = std({ map: tex(tm, { repeat: 1 / 1.2 }), normalMap: nrm(th, 1.8, 1 / 1.2), roughnessMap: smudge(0.6), roughness: 0.6 / 0.59, envMapIntensity: 0.5 });
    // bath: travertine panels on the walls, charcoal basalt on the floor
    m.wallBath = std({ color: '#f4eee4', map: tex(tm, { repeat: 1 / 1.4 }), normalMap: nrm(th, 1.8, 1 / 1.4), roughnessMap: smudge(0.8), roughness: 0.5 / 0.59, envMapIntensity: 0.45 });
    const bs = stoneTex(512, '#4a4744', '#2f2d2b', { bands: 3, pores: 0.02, seed: 35, contrast: 0.5 });
    const bt = tileTex({ size: 512, tilesX: 2, tilesY: 2, colors: ['#403d3a', '#3a3734'], grout: '#2a2826', groutW: 3, surface: bs, glaze: 0.04 });
    m.floorBath = std({ map: tex(bt.map, { repeat: 1 / 1.2 }), normalMap: nrm(bt.bump, 1.6, 1 / 1.2), roughness: 0.68, envMapIntensity: 0.5 });
    m.counter = std({ map: tex(tr, { repeat: 1 / 1.2 }), normalMap: trN, roughnessMap: smudge(0.8), roughness: 0.48 / 0.59, envMapIntensity: 0.55 });
    m.stone = m.counter;
  } else {
    const tr = stoneTex(1024, '#dcc6a0', '#b8966a', { bands: 14, pores: 0.08, seed: 7, contrast: 0.95 });
    const tt = tileTex({ size: 1024, tilesX: 2, tilesY: 2, colors: ['#d2b994', '#cbb08a', '#d8c19e', '#c9ad86'], grout: '#b59c78', groutW: 3, surface: tr, glaze: 0.06 });
    // floor height = tile grid + the travertine pores
    const th = canvas(1024), thc = th.getContext('2d'); thc.drawImage(tt.bump, 0, 0); thc.globalCompositeOperation = 'multiply'; thc.drawImage(tr.height_, 0, 0); th.__tk = 'rivieraFloorH';
    m.floor = std({ map: tex(tt.map, { repeat: 1 / 1.6 }), normalMap: nrm(th, 2.2, 1 / 1.6), roughnessMap: smudge(0.6), roughness: 0.62 / 0.59, envMapIntensity: 0.42 });
    const trN = nrm(tr.height_, 1.6, 1 / 1.4);
    m.marble = std({ map: tex(tr, { repeat: 1 / 1.4 }), normalMap: trN, roughnessMap: smudge(0.8), roughness: 0.45 / 0.59, envMapIntensity: 0.6 });
    const zel = tileTex({ size: 512, tilesX: 8, tilesY: 8, colors: ['#ebe1cf', '#e7dcc8', '#eee5d5', '#e4d8c2', '#e9dfcc'], grout: '#dccdb3', groutW: 3, glaze: 0.035 });
    // zellige: hand-made undulating glaze → low-frequency height on top of the grout grid
    const zh = canvas(512), zhc = zh.getContext('2d'); zhc.drawImage(zel.bump, 0, 0); zhc.globalAlpha = 0.35; zhc.drawImage(plasterTex(31, 0.9, 512), 0, 0); zhc.globalAlpha = 1; zh.__tk = 'rivieraZelligeH';
    m.wallBath = phys({ map: tex(zel.map, { repeat: 1 / 0.8 }), normalMap: nrm(zh, 2.2, 1 / 0.8), roughness: 0.32, clearcoat: 0.45, clearcoatRoughness: 0.22, envMapIntensity: 0.85 });
    const bt = tileTex({ size: 512, tilesX: 6, tilesY: 6, colors: ['#b8653f', '#c07049', '#ad5d39', '#c47a55', '#b26a44'], grout: '#d9c7aa', groutW: 3, glaze: 0.1 });
    m.floorBath = std({ map: tex(bt.map, { repeat: 1 / 1.2 }), normalMap: nrm(bt.bump, 1.6, 1 / 1.2), roughness: 0.62 });
    m.counter = std({ map: tex(tr, { repeat: 1 / 1.2 }), normalMap: trN, roughnessMap: smudge(0.8), roughness: 0.4 / 0.59, envMapIntensity: 0.55 });
    m.stone = m.counter;
  }
  // outdoor deck: large-format porcelain
  {
    const col = V({ milano: ['#6d6a66', '#65625e'], nordic: ['#a9a6a0', '#a19e98'], riviera: ['#cdb89a', '#c5b091'], monaco: ['#5e5b57', '#56534f'], kyoto: ['#b9b1a4', '#b2aa9c'], paris: ['#bdb8ae', '#b5b0a5'] });
    const st = stoneTex(512, col[0], col[1], { bands: 2, seed: 30, contrast: 0.3 });
    const ot = tileTex({ size: 512, tilesX: 2, tilesY: 4, colors: col, grout: '#555', groutW: 2, surface: st, pattern: 'brick' });
    m.floorOut = std({ map: tex(ot.map, { repeat: 1 / 1.2 }), normalMap: nrm(ot.bump, 1.5, 1 / 1.2), roughness: 0.75 });
  }

  // ---------- walls / ceiling
  const wallCol = V({ milano: '#bcb3a7', nordic: '#f1efea', riviera: '#eadcc6', monaco: '#d3c6b1', kyoto: '#e4dacb', paris: '#f4f1ea' });
  m.wall = std({ color: wallCol, map: m.fam === 'riviera' && styleId !== 'paris' || styleId === 'kyoto' ? lime : plaster, normalMap: nPlaster, normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: smudge(0.4), roughness: 1.5, envMapIntensity: 0.24 });
  m.ceiling = std({ color: V({ milano: '#e9e3da', nordic: '#f3f1ed', riviera: '#eee5d7', monaco: '#ece4d6', kyoto: '#efe8dc', paris: '#f6f4ee' }), roughness: 0.95, envMapIntensity: 0.2 });
  if (styleId === 'paris') { m.wall.envMapIntensity = 0.5; m.ceiling.envMapIntensity = 0.4; m.wall.emissive = new THREE.Color('#f4f1ea'); m.wall.emissiveIntensity = 0.14; }   // ivory rooms: more of the ambient fill, never grey in the shade
  m.cutCap = std({ color: '#f4f2ee', roughness: 0.9 });
  m.skirting = std({ color: V({ milano: '#2a2522', nordic: '#f4f2ee', riviera: '#e2d2b8', monaco: '#1b2333', kyoto: '#cdb895', paris: '#f5f3ed' }), roughness: 0.45, envMapIntensity: 0.6 });
  m.exterior = std({ color: '#ece8e0', map: plaster, roughness: 0.85 });

  // ---------- woods
  const woodBase = V({ milano: '#5a3a26', nordic: '#d2b893', riviera: '#9b7552', monaco: '#4f3322', kyoto: '#c9ad85', paris: '#b38e62' });
  // tile ≈ 0.9 m; the grain runs along the texture's u → along world X/Z (horizontal) after the bake's world-UV projection
  // o.vertical: grain runs up the texture (cabinet fronts, doors, wall panels are veneered with vertical grain; the
  // bake's world-UV projection maps texture v to world Y on vertical faces)
  const rot90 = (src) => { const d = canvas(src.height, src.width), x = d.getContext('2d'); x.translate(d.width, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0); if (src.__tk) d.__tk = src.__tk + '|rot90'; return d; };
  const woodM = (col, seed, rough, rep = 1.1, o = {}) => { let c = woodFurnitureTex(hex(col), seed, 512, o); if (o.vertical) { const r = rot90(c); r.rough_ = rot90(c.rough_); r.height_ = rot90(c.height_); c = r; } return std({ map: tex(c, { repeat: rep }), normalMap: tex(normalFromHeight(c.height_, 1.4), { srgb: false, repeat: rep }), normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: tex(c.rough_, { srgb: false, repeat: rep }), roughness: rough, envMapIntensity: 0.6 }); };
  m.wood = woodM(woodBase, 5, 0.6);
  m.woodDark = woodM(V({ milano: '#3c271b', nordic: '#8a6d50', riviera: '#6e4f35', monaco: '#3a2418', kyoto: '#3e322a', paris: '#5a3f2e' }), 6, 0.55, 1.1, { contrast: 0.3, vertical: true });
  m.woodLight = woodM(styleId === 'kyoto' ? '#dcc8a6' : '#d8c3a2', 9, 0.72, 1.1, { contrast: 0.16, rings: 64 });
  m.teak = woodM('#8c6440', 10, 0.9, 2);
  // feature wall: milano = fluted walnut; nordic = oak slats; riviera = limewash plaster arch niche
  m.wallAccent = m.fam === 'milano' ? m.woodDark : m.fam === 'nordic' ? m.woodLight
    : styleId === 'paris' ? std({ color: '#e4d7d0', map: plaster, normalMap: nPlaster, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.9, envMapIntensity: 0.4, emissive: new THREE.Color('#e4d7d0'), emissiveIntensity: 0.12 })   // blush-greige panel infill
    : std({ color: '#dcc6a6', map: lime, normalMap: nPlaster, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95 });

  // ---------- lacquer / cabinetry
  const lac = V({ milano: '#1f1e1d', nordic: '#efede8', riviera: '#6f7350' });
  m.lacquer = phys({ color: lac, roughnessMap: smudge(0.9), roughness: styleId === 'milano' ? 0.55 : 0.8, clearcoat: styleId === 'riviera' ? 0.4 : 0.2, clearcoatRoughness: 0.4, envMapIntensity: 0.6 });
  // nordic joinery: pale ash veneer (matt oiled) instead of flat white lacquer
  if (styleId === 'nordic') m.lacquer = woodM('#e3d5bf', 15, 0.62, 1.1, { contrast: 0.1, rings: 72, vertical: true });
  // monaco: deep midnight-navy piano lacquer; kyoto: vertical-grain white-oak veneer
  if (styleId === 'monaco') m.lacquer = phys({ color: '#18213a', roughnessMap: smudge(0.9), roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 0.8 });
  if (styleId === 'kyoto') m.lacquer = woodM('#5e4b3b', 15, 0.6, 1.1, { contrast: 0.2, rings: 72, vertical: true });   // smoked oak joinery
  // paris: cream hand-painted shaker fronts (kitchen, vanity), ivory joinery elsewhere
  if (styleId === 'paris') m.lacquer = phys({ color: '#e3d9c6', roughnessMap: smudge(0.9), roughness: 0.7, clearcoat: 0.25, clearcoatRoughness: 0.45, envMapIntensity: 0.55 });
  m.lacquer2 = m.fam === 'nordic' ? m.woodLight : m.fam === 'milano' ? m.wood : phys({ color: styleId === 'paris' ? '#eee9df' : '#e8dcc6', roughness: 0.6, clearcoat: 0.2 });
  m.doorLeaf = m.fam === 'milano' ? m.woodDark : styleId === 'kyoto' ? m.woodLight : std({ color: V({ nordic: '#f4f2ee', riviera: '#e9dcc6', paris: '#f3f0ea' }), roughness: 0.6 });
  m.frame = std({ color: V({ milano: '#1d1c1b', nordic: '#262626', riviera: '#5a4a3a', monaco: '#1a1c22', kyoto: '#33291f', paris: '#2e2a25' }), roughness: 0.45, metalness: 0.4 });
  m.doorFrame = m.fam === 'milano' ? m.woodDark : m.skirting;

  // ---------- metals
  m.brass = styleId === 'monaco'
    ? std({ color: '#d6ad66', metalness: 1, roughness: 0.24, envMapIntensity: 1.35 })   // brighter brushed gold-brass
    : styleId === 'paris' ? std({ color: '#a07c48', metalness: 1, roughness: 0.42, roughnessMap: smudge(1.5), envMapIntensity: 0.95 })   // antique (aged) brass
    : std({ color: '#c49a5c', metalness: 1, roughness: 0.3, envMapIntensity: 1.2 });
  // kyoto: dark oil-rubbed bronze takes the place of matte black everywhere (handles, legs, taps, frames)
  m.blackMetal = styleId === 'kyoto'
    ? std({ color: '#4a3a2b', metalness: 0.85, roughness: 0.42, envMapIntensity: 0.9 })
    : std({ color: '#141414', metalness: 0.35, roughness: 0.5, envMapIntensity: 0.8 });   // powder-coated
  m.chrome = std({ color: '#e8e8e8', metalness: 1, roughness: 0.08, envMapIntensity: 1.3 });
  m.steel = std({ color: '#b9bbbd', metalness: 1, roughness: 0.32, envMapIntensity: 1.1 });
  m.metal = m.fam === 'nordic' ? m.blackMetal : m.brass;       // style accent metal (handles, legs, lamp parts)
  m.tap = m.fam === 'nordic' ? m.blackMetal : m.brass;
  m.applianceGlass = phys({ color: '#0c0c0d', roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
  m.screen = phys({ color: '#050506', roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04 });
  m.rubber = std({ color: '#222', roughness: 0.9 });

  // ---------- glass & mirror (no transmission pass: cheap transparent PBR)
  m.glass = phys({ color: '#dfe9ea', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide });
  m.glassFrosted = phys({ color: '#eef2f2', roughness: 0.5, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  m.crystal = phys({ color: '#ffffff', roughness: 0.02, transparent: true, opacity: 0.3, envMapIntensity: 1.8, depthWrite: false });
  m.mirror = std({ color: '#d9dde0', metalness: 1, roughness: 0.02, envMapIntensity: 1.6 });
  m.wine = phys({ color: '#4a0710', roughness: 0.05, transparent: true, opacity: 0.85 });
  m.water = phys({ color: '#9fb9bd', roughness: 0.02, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 0.6 });

  // ---------- fabrics & upholstery
  const P = {
    milano: { sofa: ['#34363b', velvet], chair: ['#7a4526', null], accent: '#8a4b2a', c1: '#8c5a2b', c2: '#bfa06a', c3: '#2c2c30', throw: '#6b6258', duvet: '#d8d2c8', head: '#34333a', curtain: '#8d8274', sheer: '#e8e2d8', towel: '#2d2b2a', towel2: '#c9b89c', outdoor: '#57534e' },
    nordic: { sofa: ['#c6c1b8', linen], chair: ['#ece6da', boucle], accent: '#7d8c7a', c1: '#8a9b86', c2: '#d6b98c', c3: '#8ea1ad', throw: '#9c948a', duvet: '#f3f1ec', head: '#cfc8bd', curtain: '#f1eee7', sheer: '#faf8f4', towel: '#f1efea', towel2: '#aab4a8', outdoor: '#d9d5cd' },
    riviera: { sofa: ['#efe7d8', boucle], chair: ['#e5dac6', boucle], accent: '#b5623b', c1: '#b0674a', c2: '#7b7f52', c3: '#e2c69a', throw: '#b99477', duvet: '#f1e9dc', head: '#e3d6c1', curtain: '#e6dac5', sheer: '#f7f1e6', towel: '#efe6d5', towel2: '#b5623b', outdoor: '#ece2cf' },
    monaco: { sofa: ['#17463a', velvet], chair: ['#24365f', velvet], accent: '#a8823f', c1: '#c49a4c', c2: '#e6dbc6', c3: '#1c2947', throw: '#c8b28a', duvet: '#efe8dc', head: '#2a3d68', curtain: '#2f3b5a', sheer: '#efe7d8', towel: '#f1ece2', towel2: '#17463a', outdoor: '#4a4c52' },
    paris: { sofa: ['#ece5d7', boucle], chair: ['#b9cbda', velvet], accent: '#d2a59f', c1: '#b9cbda', c2: '#e6c8c1', c3: '#f0eadd', throw: '#c9baa8', duvet: '#f5f1e9', head: '#ebcfc8', curtain: '#e9e2d3', sheer: '#fbf8f1', towel: '#f6f3ee', towel2: '#d6b0aa', outdoor: '#e6dfd0' },
    kyoto: { sofa: ['#d6ccbb', linen], chair: ['#ebe4d6', boucle], accent: '#6e7259', c1: '#8b8f74', c2: '#b07b5a', c3: '#4b4540', throw: '#a69a88', duvet: '#f2ede4', head: '#cbbfa9', curtain: '#ece5d8', sheer: '#f8f4ec', towel: '#ece6da', towel2: '#8b8f74', outdoor: '#cfc6b6' },
  }[styleId];
  const NF = { [velvet.uuid]: nVelvet, [boucle.uuid]: nBoucle, [linen.uuid]: nLinen };
  const nOf = (t) => (t && NF[t.uuid]) || nWeave;
  m.fabric = styleId === 'milano'
    ? phys({ color: P.sofa[0], map: velvet, normalMap: nVelvet, roughness: 0.82, sheen: 1, sheenColor: new THREE.Color('#8b8a92'), sheenRoughness: 0.35, envMapIntensity: 0.45 })
    : styleId === 'monaco'   // emerald silk velvet: a strong, light-green sheen lobe
    ? phys({ color: P.sofa[0], map: velvet, normalMap: nVelvet, roughness: 0.78, sheen: 1, sheenColor: new THREE.Color('#5fb894'), sheenRoughness: 0.32, envMapIntensity: 0.5 })
    : std({ color: P.sofa[0], map: P.sofa[1], normalMap: nOf(P.sofa[1]), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, envMapIntensity: 0.4 });
  m.fabricAccent = styleId === 'milano'
    ? phys({ color: P.chair[0], roughness: 0.48, map: tex(fabricTex('velvet', 12), { repeat: 3 }), normalMap: nVelvet, clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.7 }) // cognac leather
    : styleId === 'monaco'   // midnight-navy velvet (chairs, armchairs, stools)
    ? phys({ color: P.chair[0], map: velvet, normalMap: nVelvet, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#7f93c4'), sheenRoughness: 0.34, envMapIntensity: 0.5 })
    : styleId === 'paris'    // pale French-blue silk velvet
    ? phys({ color: P.chair[0], map: velvet, normalMap: nVelvet, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#e6f0f8'), sheenRoughness: 0.34, envMapIntensity: 0.5 })
    : std({ color: P.chair[0], map: P.chair[1] || fab, normalMap: nOf(P.chair[1]), roughness: 0.95, envMapIntensity: 0.4 });
  m.leather = std({ color: styleId === 'nordic' ? '#6b4a33' : '#7a4526', roughness: 0.5, map: tex(fabricTex('velvet', 13), { repeat: 3 }), normalMap: nVelvet });
  m.cushionA = m.fam === 'milano' || styleId === 'paris'
    ? phys({ color: P.c1, map: velvet, normalMap: nVelvet, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color(styleId === 'monaco' ? '#f0cf86' : styleId === 'paris' ? '#e6f0f8' : '#d9a066'), sheenRoughness: 0.4 })
    : std({ color: P.c1, map: velvet, normalMap: nVelvet, roughness: 0.9 });
  m.cushionB = std({ color: P.c2, map: linen, normalMap: nLinen, roughness: 0.95 });
  m.cushionC = std({ color: P.c3, map: fab, normalMap: nWeave, roughness: 0.95 });
  m.throw = std({ color: P.throw, map: tex(fabricTex('knit', 14), { repeat: 1 / 0.12 }), normalMap: nrm(weaveHeight('knit', 14), 2.4, 1 / 0.12), roughness: 1, side: THREE.DoubleSide });
  m.linen = std({ color: '#f6f3ee', map: linen, normalMap: nLinen, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95, envMapIntensity: 0.5 });
  m.duvet = std({ color: P.duvet, map: linen, normalMap: nLinen, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, envMapIntensity: 0.5, side: THREE.DoubleSide });
  m.headboard = m.fam === 'milano' ? (styleId === 'monaco' ? phys({ color: P.head, map: velvet, normalMap: nVelvet, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#7f93c4'), sheenRoughness: 0.34, envMapIntensity: 0.5 }) : std({ color: P.head, map: velvet, normalMap: nVelvet, roughness: 0.9 }))
    : styleId === 'paris' ? phys({ color: P.head, map: velvet, normalMap: nVelvet, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#f2d2cc'), sheenRoughness: 0.36, envMapIntensity: 0.5 })   // blush velvet
    : std({ color: P.head, map: linen, normalMap: nLinen, roughness: 0.9 });
  m.curtain = std({ color: P.curtain, map: linen, normalMap: nLinen, roughness: 0.95, side: THREE.DoubleSide });
  // sheers are back-lit by the daylight behind them: a little emissive makes them glow like real voile
  m.sheer = std({ color: P.sheer, map: linen, roughness: 0.9, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color('#fff4e4'), emissiveIntensity: 0.28 });
  // motorised blackout layer: milano charcoal-taupe velvet drapes, nordic a pale linen roller blind, riviera sage linen drapes
  m.blackout = m.fam === 'milano'
    ? std({ color: styleId === 'monaco' ? '#2a3550' : '#4d4641', map: velvet, normalMap: nVelvet, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.4 })
    : std({ color: V({ nordic: '#b8b0a3', riviera: '#a29a76', kyoto: '#c9bca6', paris: '#ebe5d8' }), map: linen, normalMap: nLinen, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  m.towel = std({ color: P.towel, map: tex(fabricTex('boucle', 15), { repeat: 6 }), normalMap: nBoucle, roughness: 1 });
  m.towel2 = std({ color: P.towel2, map: tex(fabricTex('boucle', 16), { repeat: 6 }), normalMap: nBoucle, roughness: 1 });
  m.outdoorFabric = std({ color: P.outdoor, map: fab, normalMap: nWeave, roughness: 0.95 });
  m.rug = std({ map: tex(rugTex(styleId), { repeat: 1 }), normalMap: nRug, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 1, envMapIntensity: 0.2 });
  if (styleId !== 'paris') { const ct = caneTex('#d9b98a'); m.cane = std({ map: tex(ct, { repeat: 9 }), normalMap: nrm(ct.height_, 2.2, 9), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.62, envMapIntensity: 0.45 }); }
  m.rattan = std({ color: '#b98f5a', map: tex(fabricTex('jute', 18), { repeat: 4 }), normalMap: nBoucle, roughness: 0.85 });
  // woven shades keep their own sphere UVs (a world-UV projection shows patch seams on a sphere)
  if (styleId !== 'paris') { const rw = rattanWeave('#c9a172'); m.rattanShade = std({ color: '#ffffff', map: tex(rw, { repeat: 1 }), emissiveMap: tex(rw.glow_, { repeat: 1 }), emissive: new THREE.Color(S.lightColor), emissiveIntensity: 1.6, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.4 }); }
  m.accentFabric = std({ color: P.accent, map: velvet, normalMap: nVelvet, roughness: 0.9 });
  if (styleId === 'paris') {
    // riviera's cane insets become recessed, slightly deeper-toned door panels (ivory joinery / cream kitchen)
    m.cane = m.skirting;
    m.panelIn = std({ color: '#e7decd', roughnessMap: smudge(0.9), roughness: 1.2, envMapIntensity: 0.5 });
    m.rattan = m.lacquer2;
    // plaster mouldings: boiserie frames, chair rails, cornices, ceiling roses (satin white, a touch brighter than the wall)
    // — the skirting's paint, also used for the interior door leaves: all the white joinery bakes into one mesh
    m.moulding = m.skirting; m.doorLeaf.dispose(); m.doorLeaf = m.skirting;
    // smoked-glass globes (unlit) and shelves
    m.smoked = phys({ color: '#6b5846', roughness: 0.06, transparent: true, opacity: 0.5, envMapIntensity: 1.5, depthWrite: false });
  }
  // Cloth gets a sheen lobe (the soft bright rim fabric shows at grazing angles — the single biggest cue that reads
  // "textile" instead of "painted plastic"). Standard PBR extension (KHR_materials_sheen) → survives glTF export.
  const sheenify = (k, amt = 0.8, sr = 0.55) => {
    const a = m[k]; if (!a || a.isMeshPhysicalMaterial) return;
    const p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, a);
    p.defines = { STANDARD: '', PHYSICAL: '' };
    p.sheen = amt; p.sheenRoughness = sr; p.sheenColor = a.color.clone().lerp(new THREE.Color('#ffffff'), 0.3);
    m[k] = p; a.dispose();
  };
  for (const k of ['fabric', 'fabricAccent', 'cushionA', 'cushionB', 'cushionC', 'throw', 'linen', 'duvet', 'headboard', 'curtain', 'blackout', 'accentFabric', 'outdoorFabric']) sheenify(k);
  for (const k of ['towel', 'towel2']) sheenify(k, 0.5, 0.8);
  sheenify('rattanShade', 0.3, 0.7);
  if (styleId === 'paris') {   // one blush velvet (chairs, headboard, cushions) and one pale-blue velvet → fewer draw calls
    m.accentFabric.dispose(); m.cushionB.dispose(); m.cushionA.dispose();
    m.accentFabric = m.cushionB = m.headboard; m.cushionA = m.fabricAccent;
  }

  // ---------- ceramics, table, food
  m.porcelain = phys({ color: '#fbfbfa', roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.9 });
  m.ceramic = phys({ color: V({ milano: '#f3efe8', nordic: '#f4f3ef', riviera: '#f1e8d8', monaco: '#f6f2ea', kyoto: '#e9e1d3', paris: '#f8f6f1' }), roughness: styleId === 'kyoto' ? 0.55 : 0.2, clearcoat: styleId === 'kyoto' ? 0.15 : 0.6 });
  m.ceramic2 = phys({ color: V({ milano: '#1f1f21', nordic: '#b7c1bd', riviera: '#a4664c', monaco: '#13392f', kyoto: '#3a3633', paris: '#a9bccd' }), roughness: styleId === 'kyoto' ? 0.6 : 0.3, clearcoat: styleId === 'kyoto' ? 0.1 : 0.5 });
  m.cutlery = std({ color: m.fam === 'milano' ? '#d6b27a' : '#dcdcdc', metalness: 1, roughness: 0.18, envMapIntensity: 1.3 });
  m.napkin = std({ color: V({ milano: '#6b6258', nordic: '#dcd6cb', riviera: '#b98a6c', monaco: '#17463a', kyoto: '#b8ad9a', paris: '#d9b3ad' }), map: linen, roughness: 1 });
  m.fruit = std({ color: '#e0892c', roughness: 0.55 });
  m.fruit2 = std({ color: '#b7c43d', roughness: 0.5 });
  m.fruit3 = std({ color: '#8e1f24', roughness: 0.4 });
  m.bread = std({ color: '#b8834d', roughness: 0.9 });
  m.candle = std({ color: '#f4efe4', roughness: 0.7, emissive: '#3a2a10', emissiveIntensity: 0.2 });
  m.flame = std({ color: '#ffd28a', emissive: '#ffb347', emissiveIntensity: 3 });
  m.paper = std({ map: tex(paperBooksTex(), { repeat: 1 }), roughness: 0.95 });
  m.books = std({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.4 });
  m.bottle = phys({ color: '#1f3a24', roughness: 0.1, transparent: true, opacity: 0.85, clearcoat: 1 });
  m.oil = phys({ color: '#b39a2a', roughness: 0.1, transparent: true, opacity: 0.8 });

  // ---------- cabinet interiors & their contents (openable joinery). Contents are vertex-coloured so a whole
  // wardrobe of garments / a fridge of groceries bakes into a handful of draw calls.
  m.cabinetIn = m.fam === 'milano' ? woodM('#4a3326', 17, 0.6, 1.1, { contrast: 0.22, vertical: true })
    : styleId === 'kyoto' ? woodM('#dcc9a8', 19, 0.7, 1.1, { contrast: 0.1, rings: 72, vertical: true })
    : styleId === 'paris' ? woodM('#b89a72', 19, 0.7, 1.1, { contrast: 0.12, rings: 72, vertical: true })     // oiled-oak carcasses
    : styleId === 'nordic' ? std({ color: '#efebe4', roughnessMap: smudge(0.9), roughness: 0.75, envMapIntensity: 0.5 })
    : std({ color: '#e9dfcd', map: linen, roughness: 0.85, envMapIntensity: 0.5 });
  m.clothes = std({ vertexColors: true, map: fab, normalMap: nWeave, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, envMapIntensity: 0.35 });
  m.goods = phys({ vertexColors: true, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.6 });
  m.food = phys({ vertexColors: true, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.55 });
  m.fridgeIn = std({ color: '#f3f5f6', roughness: 0.3, emissive: new THREE.Color('#dfeaf5'), emissiveIntensity: 0.07, envMapIntensity: 0.7 });
  m.coldLed = std({ color: '#ffffff', emissive: new THREE.Color('#eef5ff'), emissiveIntensity: 3.2, roughness: 1 });
  m.enamel = std({ color: '#26282b', roughness: 0.35, metalness: 0.1, envMapIntensity: 0.8 });
  m.drum = std({ color: '#c3c6c8', metalness: 0.9, roughness: 0.28, side: THREE.DoubleSide, envMapIntensity: 1.0 });
  m.hanger = m.fam === 'milano' ? m.woodDark : m.woodLight;

  // ---------- plants
  m.leaf = std({ map: tex(leafTex(V({ riviera: '#6a7a48', kyoto: '#4a5a2e', paris: '#3d6a36' }) || '#35602d')), roughness: 0.42, side: THREE.DoubleSide, envMapIntensity: 0.7 });
  m.leaf2 = std({ map: tex(leafTex(V({ riviera: '#8a9868', kyoto: '#6b7a3c', paris: '#5a8644' }) || '#4f7a35')), roughness: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  m.stem = std({ color: '#5b4632', roughness: 0.8 });
  m.soil = std({ color: '#2b2018', roughness: 1 });
  m.pot = phys({ color: V({ milano: '#1c1b1b', nordic: '#e9e6e0', riviera: '#a86a4c', monaco: '#13392f', kyoto: '#2f2b28', paris: '#f2eee6' }), roughness: 0.45, clearcoat: 0.3 });
  m.pot2 = std({ color: V({ milano: '#8a7d6d', nordic: '#b6aea3', riviera: '#d9c6a5', monaco: '#e9e1d2', kyoto: '#c9bba3', paris: '#e9e3d6' }), roughness: 0.8 });
  if (styleId === 'paris') { m.pot.dispose(); m.pot2.dispose(); m.pot = m.pot2 = m.ceramic; }      // white glazed pots = the tableware ceramic
  m.flower = std({ color: V({ milano: '#f3efe6', nordic: '#f6f2ea', riviera: '#f0c9a2', monaco: '#f6efe2', kyoto: '#f2c8cf', paris: '#edc1c6' }), roughness: 0.8, side: THREE.DoubleSide });

  // ---------- art
  m.art = [0, 1, 2].map(i => std({ map: tex(artTex(styleId, i), { repeat: 1 }), roughness: 0.9, envMapIntensity: 0.3 }));
  m.artFrame = m.fam === 'nordic' ? (styleId === 'kyoto' ? m.woodDark : m.woodLight) : m.fam === 'milano' || styleId === 'paris' ? m.brass : m.woodDark;

  // ---------- light emitters (these are what makes the scene read "lit")
  const L = new THREE.Color(S.lightColor);
  m.lightEmit = std({ color: '#ffffff', emissive: L, emissiveIntensity: 2.6, roughness: 1 });
  m.led = std({ color: '#ffffff', emissive: L, emissiveIntensity: 3.2, roughness: 1 });
  m.lampShade = std({ color: V({ milano: '#dccdb4', nordic: '#ece5d8', riviera: '#e6d3b4', monaco: '#e8d9bc', kyoto: '#efe6d4', paris: '#f3ecdf' }), map: linen, emissive: L.clone().lerp(new THREE.Color('#ff9a4a'), 0.2), emissiveMap: linen, emissiveIntensity: 0.5, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  // opal glass globes: smooth milky glass lit from inside (no fabric weave)
  m.opal = std({ color: '#f3eee6', emissive: L.clone().lerp(new THREE.Color('#ffffff'), 0.25), emissiveIntensity: 0.85, roughness: 0.25, envMapIntensity: 0.5 });
  m.bulb = std({ color: '#fff', emissive: L, emissiveIntensity: 4 });
  if (styleId === 'kyoto') {
    // washi lantern paper: lit from inside, bamboo ribs and fibres read darker; keeps its own UVs (like the rattan)
    const wt = washiTex(9);
    m.washi = std({ color: '#ffffff', map: tex(wt, { repeat: 1 }), emissive: L.clone().lerp(new THREE.Color('#ffe2b8'), 0.3), emissiveMap: tex(wt.glow_, { repeat: 1 }), emissiveIntensity: 1.25, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.2 });
    // clipped niwaki / bonsai foliage pads: clumpy bouclé-like relief in deep pine green
    m.foliage = std({ color: '#4a5a2e', map: tex(fabricTex('boucle', 23), { repeat: 9 }), normalMap: nrm(weaveHeight('boucle', 9), 3.5, 9), normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.85, envMapIntensity: 0.4 });
  }
  if (styleId === 'monaco' || styleId === 'paris') {
    // chandelier crystal: opaque, very glossy cut glass that catches the lamps (no transparency → no sorting cost)
    m.crystalLit = phys({ color: '#f2f5f8', roughness: 0.03, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.02, emissive: L.clone().lerp(new THREE.Color('#ffffff'), 0.4), emissiveIntensity: 0.2, envMapIntensity: 2.4 });
  }
  m.plastic = std({ color: '#f2f2f0', roughness: 0.35 });
  m.darkPlastic = std({ color: '#1b1b1c', roughness: 0.4 });
  m.collider = new THREE.MeshBasicMaterial({ visible: false });

  // ---------- baked-look light & shadow decals (one shared atlas; unlit, no depth write)
  // ao / aoSoft: soft contact shadows under furniture and in wall/floor/ceiling junctions (normal blending, black)
  // glow / glowFaint: additive warm light pools, downlight scallops, lamp halos, cove wash; daylight: window spill
  const fx = tex(fxAtlas(), { repeat: 1 }); fx.wrapS = fx.wrapT = THREE.ClampToEdgeWrapping;
  const dec = (o) => new THREE.MeshBasicMaterial({ map: fx, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...o });
  const aoK = V({ milano: 0.8, nordic: 0.6, riviera: 0.66, monaco: 0.78, kyoto: 0.62, paris: 0.6 });
  m.ao = dec({ color: 0x000000, opacity: aoK });
  m.aoSoft = dec({ color: 0x000000, opacity: aoK * 0.42 });
  // room-depth falloff: rooms darken away from the glazing (ceiling, floor, side walls) — the look of real daylight
  m.shade = dec({ color: 0x000000, opacity: V({ milano: 0.5, nordic: 0.36, riviera: 0.42, monaco: 0.46, kyoto: 0.38, paris: 0.36 }) });
  const gk = V({ milano: 1, nordic: 0.7, riviera: 0.8, monaco: 1, kyoto: 0.9, paris: 0.74 });
  // Additive light is tinted a little redder than the lamps: ACES compresses the red channel first when bright
  // light piles up on warm plaster, which otherwise drifts the pools towards a sickly yellow-green.
  const GL = L.clone().lerp(new THREE.Color('#ff9f5c'), 0.35);
  m.glow = dec({ color: GL, opacity: 0.44 * gk, blending: THREE.AdditiveBlending, fog: false });
  m.glowFaint = dec({ color: GL, opacity: 0.18 * gk, blending: THREE.AdditiveBlending, fog: false });
  m.daylight = dec({ color: new THREE.Color('#fff3e2'), opacity: 0.15 * gk, blending: THREE.AdditiveBlending, fog: false });
  m.lampGlow = dec({ color: new THREE.Color(S.lightColor).lerp(new THREE.Color('#ffb870'), 0.25), opacity: 0.62 * gk, blending: THREE.AdditiveBlending, fog: false });
  m.coldGlow = dec({ color: new THREE.Color('#dcecff'), opacity: 0.28, blending: THREE.AdditiveBlending, fog: false });   // fridge light
  // switched-on TV: the live picture as emission under a glossy black glass, and its cool spill on the wall around it
  m.tvLive = phys({ color: '#020203', roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.3, emissive: new THREE.Color('#ffffff'), emissiveMap: tvTexture(), emissiveIntensity: 1.35, envMapIntensity: 0.5 });
  m.tvGlow = dec({ color: new THREE.Color('#9fb8d8'), opacity: 0.3, blending: THREE.AdditiveBlending, fog: false, polygonOffset: false });
  // Camera-facing halos around bulbs / shades (one billboard mesh per apartment, built in apartment.js).
  // Each quad = 4 verts sharing the centre `position`; `corner` (±1,±1) and `bsize` expand it in view space.
  m.bloom = new THREE.ShaderMaterial({
    uniforms: { map: { value: (() => { const t = tex(bloomTex(), { srgb: false }); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; })() }, color: { value: new THREE.Color(S.lightColor).multiplyScalar(1.1 * gk + 0.3) } },
    vertexShader: `attribute vec2 corner; attribute float bsize; attribute float bk; varying vec2 vUv; varying float vK;
      void main(){ vUv = corner * 0.5 + 0.5; vK = bk; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xy += corner * bsize * 0.5; mv.z += bsize * 0.35; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; varying vec2 vUv; varying float vK;
      void main(){ float a = texture2D(map, vUv).a * vK; gl_FragColor = vec4(color * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  m.bloom.userData.noEnv = true;
  // Export hints (glTF): the halo billboard is view-space shader magic → skip it; the decals are plain unlit
  // MeshBasicMaterial quads (KHR_materials_unlit) — additive ones are marked so an exporter/viewer may drop or re-blend them.
  m.bloom.userData.noExport = true;
  for (const k of ['glow', 'glowFaint', 'daylight', 'lampGlow', 'coldGlow']) m[k].userData.additive = true;
  for (const k of ['ao', 'aoSoft', 'shade', 'glow', 'glowFaint', 'daylight', 'lampGlow', 'coldGlow']) m[k].userData.decal = true;

  // The interior IBL (RoomEnvironment, set by the host) is a bright neutral-grey box: at full strength its diffuse
  // term floods every surface with the same grey-white fill — the "washed-out" look. Keep it mostly for reflections:
  // matt surfaces take a fraction of it (the warm point lights, light decals and AO decals do the shaping), glossy
  // ones more, metals / mirrors / glass all of it.
  const envK = V({ milano: 1, nordic: 1.4, riviera: 1.12, monaco: 1.08, kyoto: 1.25, paris: 1.35 });   // the bright Scandinavian look keeps more fill
  for (const v of Object.values(m)) {
    if (!v || !v.isMaterial || v.userData.decal || !('envMapIntensity' in v)) continue;
    if (v.metalness >= 0.5 || v.transparent) continue;
    const r = v.roughness * (v.roughnessMap ? 0.6 : 1);
    v.envMapIntensity *= Math.min(1, (r >= 0.6 ? 0.42 : r >= 0.3 ? 0.62 : 0.85) * envK);
  }
  // name all materials (debug + stable bucket keys)
  for (const [k, v] of Object.entries(m)) if (v && v.isMaterial) v.name = `${styleId}.${k}`;
  // facade glazing: the cheap transparent glass plus a faint daylight emission, so windows read as the brightest
  // surface in the room (the eye adapts to the interior) without hiding the view
  m.glazing = m.glass.clone(); m.glazing.name = `${styleId}.glazing`;
  m.glazing.emissive = new THREE.Color('#dfe8f0'); m.glazing.emissiveIntensity = 0.1; m.glazing.opacity = 0.12;
  m.art.forEach((a, i) => a.name = `${styleId}.art${i}`);
  cache.set(styleId, m);
  if (typeof document !== 'undefined' && !TEXREC) TEXMEM.clear();   // the textures now own their canvases
  return m;
}
