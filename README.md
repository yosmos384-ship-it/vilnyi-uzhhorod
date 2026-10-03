# ЖК VILNYI (Ужгород) — sales website

Sales site of the residential complex **ЖК VILNYI**, вул. Михайла Грушевського, 4А, Ужгород (developer: VILNYI Group).
Four point towers (16 / 6 / 17 / 10 floors, 462 apartments in the plans) around a shared courtyard, a two-level
commercial podium, VILNYI SPA, one underground parking level.

What the site does: hero (renders + live 3D model), apartment finder (building → floor → real floor plan → unit sheet
with price and payment calculator), reservation request (lead form), 3D walkthrough (lobby, lift, corridor, apartment,
parking), gallery, construction progress (monthly photos), location map and 360° view, project facts, 8 languages
(uk default, en, he, ro, de, fr, it, ru).

Plain ES modules, **no build step**, three.js r160 from `vendor/`. Everything in this folder is static.

## Run locally

```
cd site
python3 -m http.server 8080
# open http://localhost:8080/index.html            (language: ?lang=uk|en|he|ro|de|fr|it|ru)
```

A plain file:// open does not work (ES modules and `fetch` need http).

## Where things are

| Path | What |
|---|---|
| `index.html`, `css/site.css` | the page and its styles (`css/plan.css`, `progress.css`, `panorama.css` per module) |
| `js/data.js` | **single source of truth**: project facts, contacts, terms, units, helpers |
| `js/data-plates.js`, `data-progress.js`, `data-sales.js` | GENERATED — never edit by hand (see below) |
| `js/app.js`, `plan.js`, `booking.js`, `progress.js`, `panorama.js`, `hero3d.js`, `hero-slides.js`, `pano-tour.js` | page modules |
| `js/three/` | 3D engine: exterior, commons, apartment, walkthrough, environment, cars, materials |
| `js/i18n.js`, `js/i18n/<lang>.ui.js`, `<lang>.site.js` | translations (ui = interface, site = project copy); module-own strings in `js/i18n-hero.js`, `i18n-panorama.js`, `i18n-progress.js`, `i18n-tour.js` |
| `assets/gallery/manifest.json` | the gallery: `[{src, type: exterior|amenity|interior|lobby, caption:{8 languages}}]` — list only files that exist |
| `assets/hero-slides.json` | hero slideshow |
| `assets/plans/` | floor-plan images (webp) |
| `assets/progress/` | construction photos: `<yyyy-mm>-b<N>-<n>.jpg` (full), `-thumb.jpg` (360 px wide), `-s.jpg` (240 px wide) |
| `assets/web/` | renders, layouts and icons downloaded from lun.ua and vilnyi.group |
| `assets/brand/` | logos |
| `assets/panorama/` | cube faces of the 360° view (captured with `tools/pano-capture.html`); empty → the section hides itself |

## Rebuild the data

Source data is **outside** this folder, in `../data/` (plates of the four buildings, site, progress, web assets).
From the project root (the folder that contains `site/`, `data/`, `tools/`):

```
node tools/build-data.mjs     # writes site/js/data-plates.js, data-progress.js, data-sales.js
node tools/check-data.mjs     # data acceptance checks (462 units, 137/53/159/113 …) — must end with 0 failures
node tools/check-i18n.mjs     # dictionaries: 0 missing keys, 0 unknown keys in code, 0 forbidden wording
```

## Test the whole site

```
python3 tools/test-site.py                 # everything: static checks, layout (no WebGL), 3D, walkthrough — about 50 min on software WebGL
python3 tools/test-site.py --part layout   # every section, uk + en + he, phone + desktop (about 5 min)
python3 tools/final-shots.py               # the picture set in ../shots/final/
python3 tools/pano-capture.py              # re-bake the 360° cube faces after the 3D scene changes (about 15 min)
```

## Real prices and statuses — `data/sales.json`

Until the sales office supplies a price list, prices are **estimates** computed from the price per m² of the public
listing, and every unit is "available". To publish real data create `../data/sales.json` and run `node tools/build-data.mjs`:

```json
{
  "updatedAt": "2026-10-03",
  "units": {
    "B1-5-07": { "status": "reserved", "price": 1794000 },
    "B3-12-02": { "status": "sold" },
    "B4-2-01": { "ppm": 47450 }
  }
}
```

Keys are unit ids (`B<building>-<floor>-<slot>`); `status` = `available | reserved | sold | blocked`; `price` in UAH
or `ppm` (UAH per m²). Project-wide terms (payment plans, discounts, delivery quarters, contacts, office hours) are in
`js/data.js` → `PROJECT`.

Lead delivery: `PROJECT.leadsEndpoint` / `PROJECT.leadsKey` in `js/data.js` are empty — the reservation form then keeps
the request in the browser and offers Viber / e-mail / phone. Set them when the owner issues a form key **for this project**.

## Do NOT publish

- `dev/` — per-module test pages and stubs.
- `crm.html` and `js/crm/` (+ `css/crm.css`) — the internal CRM runs in demo mode with no access control. Keep it off the
  public host until it is protected (authentication on the server side); it is not linked from `index.html`.
- Nothing from `../data/`, `../notes/`, `../src/`, `../tools/` belongs on the web host.

## Known limits (see `../notes/`)

- 3D walkthrough of the flat: 355 of 462 flats (77 %). The other 107 are "plan only": the schematic 3D planner cannot show
  their layout truthfully (a bedroom would be missing, the living room would have no window, or the 3D box holds under 62 % of
  the flat). Their sheets have the real plan, price, calculator and reservation; the list is `PLAN_ONLY` in `tools/build-data.mjs`.
- Without WebGL the walkthrough and the live 3D are not offered (static renders, the SVG elevation and the place list instead).

- Apartment numbering is sequential per building (the plans print no numbers) and is marked provisional on the site.
- Delivery dates are the listing's and are shown as planned. Building 2: the plans show 6 floors; the developer's current
  render shows a taller building — to be confirmed by the owner.
- Renders are illustrative. Construction photos carry their source credit (LUN / VILNYI Group).
