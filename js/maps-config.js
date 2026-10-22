// ЖК VILNYI (Uzhhorod) — Google Maps Platform settings for the «Location on Google Maps» section (js/location-maps.js).
// THE ONLY PLACE the key is written. It is a browser key: every visitor can see it, by design — protect it in
// Google Cloud Console → APIs & Services → Credentials → this key:
//   Application restrictions → Websites: https://vilnyi-gt-city.uz.ua/* and https://www.vilnyi-gt-city.uz.ua/*
//   API restrictions → Maps JavaScript API, Places API (New) (+ Routes API only if ROUTE_TIMES is switched on).
// Set ENABLED to false (or the key to '') and the section shows its poster, the curated place list and the
// navigation buttons only — no request goes to Google. No side effects on import. Never log the key.
export const GOOGLE_MAPS_API_KEY = 'AIzaSyCHgOe-pPX_LfL55bMqher0fP77McLCzL4';
export const MAPS = {
  ENABLED: true,
  // Map ID (Cloud Console → Map management): the owner's own vector Map ID. With a Map ID the code's dark `styles`
  // array is ignored by Google — the dark / gold look is set in Cloud Console → Map Styles for this ID.
  // Empty → the 2D map uses the built-in dark style in js/location-maps.js.
  MAP_ID: '6d106ba3d67a6540b64ed508',
  // Google photorealistic 3D (buildings, trees) over the project. null = not known: the flyover uses a camera that looks
  // right both with the photorealistic mesh and with the worldwide satellite-on-3D-terrain layer. true = mesh confirmed
  // (closer, lower orbit). false = mesh confirmed absent. Google publishes coverage only as an interactive map:
  // https://developers.google.com/maps/documentation/javascript/3d/coverage
  PHOTOREAL_3D: null,
  // Exact walking / driving minutes from the Routes API (RouteMatrix). false → minutes are estimated from the distance
  // (marked «≈»). Switch on only after enabling «Routes API» for the key (billed per element).
  ROUTE_TIMES: false,
  // Places (New) nearby search: radius per category in metres, results per category (max 20).
  RADIUS: 1500, MAX_RESULTS: 8,
};
// ---- Google Photorealistic 3D Tiles inside the 3D worlds (js/three/google3d.js) ----------------------------------------
// A SEPARATE key for the Map Tiles API. Empty '' = the feature is OFF and the 3D worlds are exactly the classic ones
// (OpenStreetMap / procedural city); nothing is downloaded from Google by them. Set it = ON: a "🌍 Google 3D / 🗺 Classic"
// toggle appears in the 3D views and the real city is streamed live from Google.
// The key MUST belong to a Google Cloud project whose billing account has a billing address OUTSIDE the EEA: since 8 July 2025
// Google answers 403 "…not available for your account and region" for EEA billing accounts (Map Tiles API EEA terms). On a
// 403 / 429 / no network / no 3D coverage the worlds fall back to the classic city by themselves, with a short note.
// Restrict the key in Cloud Console → Credentials: Websites = this site's domains; APIs = Map Tiles API only. Never log it.
export const GOOGLE_3D_KEY = '';
// No photorealistic coverage (only a coarse globe): if the finest tile on screen stays coarser than this (metres of
// geometric error) once loading has settled, the world goes back to the classic city ("no Google 3D coverage here").
export const GOOGLE_3D_MIN_DETAIL_M = 6;

export default { GOOGLE_MAPS_API_KEY, MAPS, GOOGLE_3D_KEY, GOOGLE_3D_MIN_DETAIL_M };
