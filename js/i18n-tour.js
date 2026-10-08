// ЖК VILNYI (Uzhhorod) — strings for the photoreal 360° tour (js/pano-tour.js) and its button in the unit panel (js/app.js). 7 languages (uk, en, he, ro, de, fr, it).
// tt(lang, 'hint') · tt(lang, 'r.living') · tt(lang, 's.milano') · tt(lang, 'm.dusk') (light modes) · tt(lang, 'light')
export const TOUR_I18N = {
  en: {
    photo: 'Real 360°', reserve: 'Reserve', btn: 'Photoreal tour', soon: 'Photoreal tour coming soon', soonHint: 'The photoreal tour for this apartment type is coming soon — walk inside in live 3D meanwhile.', toggle: 'Switch between photo-real and live 3D', map: 'Plan',
    title: 'Photoreal 360°', loading: 'Loading the photoreal tour…', exit: 'Exit', live3d: 'Live 3D', design: 'Design', plan: 'Plan',
    hint: 'Drag to look around · tap a gold circle to walk', gyro: 'Motion', gyroOff: 'Motion sensor unavailable',
    sample: 'Sample apartment of the same type', illus: 'Illustrative visualisation', none: 'The photoreal tour for this apartment is being prepared.',
    apartment: 'Apartment', building: 'Building', zoomIn: 'Zoom in', zoomOut: 'Zoom out', upper: 'upper level', rooms: 'rooms',
    r: { living: 'Living room', kitchen: 'Kitchen', hall: 'Entrance hall', bedroom: 'Bedroom', bath: 'Bathroom', storage: 'Storage', dressing: 'Dressing room', balcony: 'Balcony', loggia: 'Loggia', terrace: 'Terrace', lobby: 'Lobby', corridor: 'Corridor', parking: 'Parking' },
    light: 'Light', m: { day: 'Day', dusk: 'Dusk', night: 'Night' },
    s: { milano: 'Milano', nordic: 'Nordic', riviera: 'Riviera', monaco: 'Monaco', kyoto: 'Kyoto', paris: 'Paris' },
  },
  he: {
    photo: '360° אמיתי', reserve: 'שריון הדירה', btn: 'סיור מציאותי 360°', soon: 'סיור מציאותי – בקרוב', soonHint: 'הסיור המציאותי לטיפוס דירה זה יעלה בקרוב – בינתיים אפשר להסתובב בדירה בתלת־ממד חי.', toggle: 'מעבר בין תצוגה מציאותית לתלת־ממד חי', map: 'תוכנית',
    title: 'סיור 360° מציאותי', loading: 'טוען את הסיור המציאותי…', exit: 'יציאה', live3d: '3D חי', design: 'עיצוב', plan: 'תוכנית',
    hint: 'גררו כדי להביט סביב · הקישו על עיגול זהב כדי להתקדם', gyro: 'תנועה', gyroOff: 'חיישן התנועה אינו זמין',
    sample: 'דירה לדוגמה מאותו טיפוס', illus: 'הדמיה להמחשה בלבד', none: 'הסיור המציאותי לדירה זו נמצא בהכנה.',
    apartment: 'הדירה', building: 'הבניין', zoomIn: 'התקרבות', zoomOut: 'התרחקות', upper: 'מפלס עליון', rooms: 'חדרים',
    r: { living: 'סלון', kitchen: 'מטבח', hall: 'מבואת כניסה', bedroom: 'חדר שינה', bath: 'חדר רחצה', storage: 'מחסן', dressing: 'חדר ארונות', balcony: 'מרפסת', loggia: 'לוגיה', terrace: 'מרפסת גג', lobby: 'לובי', corridor: 'מסדרון', parking: 'חניון' },
    light: 'תאורה', m: { day: 'יום', dusk: 'דמדומים', night: 'לילה' },
    s: { milano: 'מילאנו', nordic: 'נורדי', riviera: 'ריביירה', monaco: 'מונקו', kyoto: 'קיוטו', paris: 'פריז' },
  },
  uk: {
    photo: '360° реальне', reserve: 'Забронювати', btn: 'Фотореалістичний тур', soon: 'Фотореалістичний тур — незабаром', soonHint: 'Фотореалістичний тур для цього типу квартири з’явиться незабаром — поки прогуляйтеся всередині в живому 3D.', toggle: 'Перемкнути: фотореалізм або живе 3D', map: 'План',
    title: 'Фотореалістичний тур 360°', loading: 'Завантажуємо фотореалістичний тур…', exit: 'Вихід', live3d: '3D наживо', design: 'Дизайн', plan: 'План',
    hint: 'Потягніть, щоб роздивитися · торкніться золотого кола, щоб пройти', gyro: 'Гіроскоп', gyroOff: 'Датчик руху недоступний',
    sample: 'Зразок квартири того самого типу', illus: 'Ілюстративна візуалізація', none: 'Фотореалістичний тур для цієї квартири готується.',
    apartment: 'Квартира', building: 'Будинок', zoomIn: 'Наблизити', zoomOut: 'Віддалити', upper: 'верхній рівень', rooms: 'кімн.',
    r: { living: 'Вітальня', kitchen: 'Кухня', hall: 'Передпокій', bedroom: 'Спальня', bath: 'Ванна кімната', storage: 'Комора', dressing: 'Гардеробна', balcony: 'Балкон', loggia: 'Лоджія', terrace: 'Тераса', lobby: 'Лобі', corridor: 'Коридор', parking: 'Паркінг' },
    light: 'Освітлення', m: { day: 'День', dusk: 'Сутінки', night: 'Ніч' },
    s: { milano: 'Мілано', nordic: 'Нордік', riviera: 'Рив’єра', monaco: 'Монако', kyoto: 'Кіото', paris: 'Париж' },
  },
  ro: {
    photo: '360° real', reserve: 'Rezervă', btn: 'Tur fotorealist', soon: 'Tur fotorealist în curând', soonHint: 'Turul fotorealist pentru acest tip de apartament vine în curând — între timp, plimbă-te în interior în 3D live.', toggle: 'Comută între foto-real și 3D live', map: 'Plan',
    title: 'Tur fotorealist 360°', loading: 'Se încarcă turul fotorealist…', exit: 'Ieșire', live3d: '3D live', design: 'Design', plan: 'Plan',
    hint: 'Trage pentru a privi în jur · atinge un cerc auriu pentru a înainta', gyro: 'Mișcare', gyroOff: 'Senzorul de mișcare nu este disponibil',
    sample: 'Apartament model de același tip', illus: 'Vizualizare cu caracter ilustrativ', none: 'Turul fotorealist pentru acest apartament este în pregătire.',
    apartment: 'Apartamentul', building: 'Clădirea', zoomIn: 'Apropie', zoomOut: 'Depărtează', upper: 'nivelul superior', rooms: 'camere',
    r: { living: 'Living', kitchen: 'Bucătărie', hall: 'Hol de intrare', bedroom: 'Dormitor', bath: 'Baie', storage: 'Debara', dressing: 'Dressing', balcony: 'Balcon', loggia: 'Logie', terrace: 'Terasă', lobby: 'Hol principal', corridor: 'Coridor', parking: 'Parcare' },
    light: 'Lumină', m: { day: 'Zi', dusk: 'Amurg', night: 'Noapte' },
    s: { milano: 'Milano', nordic: 'Nordic', riviera: 'Riviera', monaco: 'Monaco', kyoto: 'Kyoto', paris: 'Paris' },
  },
  fr: {
    photo: '360° réel', reserve: 'Réserver', btn: 'Visite photoréaliste', soon: 'Visite photoréaliste bientôt', soonHint: 'La visite photoréaliste de ce type d’appartement arrive bientôt — en attendant, visitez-le en 3D en direct.', toggle: 'Basculer entre photo-réel et 3D en direct', map: 'Plan',
    title: 'Visite photoréaliste 360°', loading: 'Chargement de la visite photoréaliste…', exit: 'Quitter', live3d: '3D en direct', design: 'Style', plan: 'Plan',
    hint: 'Faites glisser pour regarder autour · touchez un cercle doré pour avancer', gyro: 'Mouvement', gyroOff: 'Capteur de mouvement indisponible',
    sample: 'Appartement témoin du même type', illus: 'Visualisation non contractuelle', none: 'La visite photoréaliste de cet appartement est en préparation.',
    apartment: 'Appartement', building: 'Immeuble', zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière', upper: 'niveau supérieur', rooms: 'pièces',
    r: { living: 'Séjour', kitchen: 'Cuisine', hall: 'Entrée', bedroom: 'Chambre', bath: 'Salle de bains', storage: 'Rangement', dressing: 'Dressing', balcony: 'Balcon', loggia: 'Loggia', terrace: 'Terrasse', lobby: 'Hall d’entrée', corridor: 'Couloir', parking: 'Parking' },
    light: 'Lumière', m: { day: 'Jour', dusk: 'Crépuscule', night: 'Nuit' },
    s: { milano: 'Milano', nordic: 'Nordique', riviera: 'Riviera', monaco: 'Monaco', kyoto: 'Kyoto', paris: 'Paris' },
  },
  it: {
    photo: '360° reale', reserve: 'Prenota', btn: 'Tour fotorealistico', soon: 'Tour fotorealistico in arrivo', soonHint: 'Il tour fotorealistico di questa tipologia arriva presto — nel frattempo visitala in 3D dal vivo.', toggle: 'Passa tra foto-reale e 3D dal vivo', map: 'Pianta',
    title: 'Tour fotorealistico 360°', loading: 'Caricamento del tour fotorealistico…', exit: 'Esci', live3d: '3D dal vivo', design: 'Stile', plan: 'Pianta',
    hint: 'Trascina per guardarti intorno · tocca un cerchio dorato per avanzare', gyro: 'Movimento', gyroOff: 'Sensore di movimento non disponibile',
    sample: 'Appartamento campione dello stesso tipo', illus: 'Visualizzazione indicativa', none: 'Il tour fotorealistico di questo appartamento è in preparazione.',
    apartment: 'Appartamento', building: 'Edificio', zoomIn: 'Avvicina', zoomOut: 'Allontana', upper: 'livello superiore', rooms: 'locali',
    r: { living: 'Soggiorno', kitchen: 'Cucina', hall: 'Ingresso', bedroom: 'Camera da letto', bath: 'Bagno', storage: 'Ripostiglio', dressing: 'Cabina armadio', balcony: 'Balcone', loggia: 'Loggia', terrace: 'Terrazza', lobby: 'Lobby', corridor: 'Corridoio', parking: 'Parcheggio' },
    light: 'Luce', m: { day: 'Giorno', dusk: 'Crepuscolo', night: 'Notte' },
    s: { milano: 'Milano', nordic: 'Nordico', riviera: 'Riviera', monaco: 'Monaco', kyoto: 'Kyoto', paris: 'Parigi' },
  },
  de: {
    photo: '360° real', reserve: 'Reservieren', btn: 'Fotorealistische Tour', soon: 'Fotorealistische Tour folgt in Kürze', soonHint: 'Die fotorealistische Tour für diesen Wohnungstyp folgt in Kürze — bis dahin in Live-3D hineingehen.', toggle: 'Zwischen fotoreal und Live-3D wechseln', map: 'Grundriss',
    title: 'Fotorealistische 360°-Tour', loading: 'Fotorealistische Tour wird geladen…', exit: 'Schließen', live3d: '3D live', design: 'Design', plan: 'Grundriss',
    hint: 'Ziehen zum Umsehen · goldenen Kreis antippen, um weiterzugehen', gyro: 'Bewegung', gyroOff: 'Bewegungssensor nicht verfügbar',
    sample: 'Musterwohnung desselben Typs', illus: 'Illustrative Visualisierung', none: 'Die fotorealistische Tour für diese Wohnung wird vorbereitet.',
    apartment: 'Wohnung', building: 'Gebäude', zoomIn: 'Vergrößern', zoomOut: 'Verkleinern', upper: 'obere Ebene', rooms: 'Zimmer',
    r: { living: 'Wohnzimmer', kitchen: 'Küche', hall: 'Eingangsdiele', bedroom: 'Schlafzimmer', bath: 'Badezimmer', storage: 'Abstellraum', dressing: 'Ankleide', balcony: 'Balkon', loggia: 'Loggia', terrace: 'Terrasse', lobby: 'Lobby', corridor: 'Flur', parking: 'Tiefgarage' },
    light: 'Licht', m: { day: 'Tag', dusk: 'Dämmerung', night: 'Nacht' },
    s: { milano: 'Milano', nordic: 'Nordic', riviera: 'Riviera', monaco: 'Monaco', kyoto: 'Kyoto', paris: 'Paris' },
  },
};
export const TOUR_LANGS = Object.keys(TOUR_I18N);
export const RTL = new Set(['he']);

export function tt(lang, key) {
  const L = TOUR_I18N[String(lang || 'en').slice(0, 2)] || TOUR_I18N.en;
  const get = (o) => key.split('.').reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), o);
  const v = get(L);
  return v !== undefined ? v : (get(TOUR_I18N.en) ?? key);
}
