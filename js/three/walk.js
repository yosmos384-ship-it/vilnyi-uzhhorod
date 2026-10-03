// ЖК VILNYI (Ужгород) — first-person walkthrough engine.
// One renderer + scene: environment + complex (four point towers) + floor commons & lifts of the tower / floor the
// walker is on + the target apartment. Controls (desktop + touch), collisions against userData.solid, floor following
// on userData.floor, lift rides (−1, 1 … N per tower), teleports, 360° mode, design switcher, minimap and a HUD.
// Every sibling module (environment, exterior, apartment, commons, materials, cars) is loaded dynamically and is
// optional: when one is missing or throws, the matching fallback below (_fallbackEnv, _fallbackApartment,
// _fallbackCommons, _fallbackOutdoor) keeps the tour usable.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  UNITS, TYPES, BUILDINGS, B_IDS, GEOM, LEVELS, PROJECT, DEFAULT_SEL, SITE_CENTER, PARKING, RAMPS, coresOf, corridorsOf, footprintOf, hallEdgesOf,
  floorY, floorH, floorsOf, liftFloors, topFloor, floorFromY, floorLabel, isGround, unitById, unitsOn, blocksOn, unitLabel, unitToLocal, unitToWorld, unitYaw, money,
  worldToLocal, buildingCenter,
} from '../data.js';
import { I18N } from '../i18n.js';

const EYE = 1.62, EYE_360 = 1.55, SPEED = 1.4, RUN = 2.4, RADIUS = 0.28, STEP_UP = 0.45, STEP_DOWN = 1.1;
const RAY_HEIGHTS = [0.3, 1.0, 1.6];
const CAR_DEPTH = 1.05;        // lift car centre behind the landing door (m)
const MAX_DPR = 1.75;

// English fallbacks for every HUD string (used when i18n has no such key).
const EN = {
  'walk.lobby': 'Lobby', 'walk.corridor': 'Corridor', 'walk.apartment': 'Apartment', 'walk.balcony': 'Balcony',
  'walk.parking': 'Parking', 'walk.lift': 'Lift', 'walk.floor': 'Floor', 'ul.building': 'Building',
  'walk.reserve': 'Reserve', 'walk.exit': 'Exit', 'walk.design': 'Design', 'walk.day': 'Day', 'walk.dusk': 'Dusk',
  'walk.night': 'Night', 'walk.walk': 'Walk', 'walk.360': '360°', 'walk.rooms': 'Rooms', 'walk.goto': 'Go to',
  'walk.loading': 'Preparing the residence…', 'walk.chooseFloor': 'Choose a floor', 'walk.help': 'How to move',
  'walk.help.title': 'Explore freely', 'walk.help.ok': 'Start exploring',
  'walk.help.drag': 'Drag to look around', 'walk.help.keys': 'W A S D or the arrow keys to walk',
  'walk.help.dblclick': 'Double-click the floor to glide there', 'walk.help.pad': 'Hold the arrows to walk and turn',
  'walk.help.dbltap': 'Double-tap to glide forward', 'walk.help.click': 'Tap doors and lift buttons to use them',
  'walk.help.360': '360° mode: stand still and look around',
  'walk.room.living': 'Living', 'walk.room.kitchen': 'Kitchen', 'walk.room.hall': 'Hall', 'walk.room.bedroom': 'Bedroom',
  'walk.room.bath': 'Bathroom', 'walk.room.storage': 'Storage', 'walk.room.dressing': 'Dressing', 'walk.room.balcony': 'Balcony',
  'walk.room.loggia': 'Loggia', 'walk.room.terrace': 'Terrace', 'walk.upper': 'upper level',
  'walk.photo': 'Photo', 'walk.photoSaved': 'Photo captured',
  'walk.mode3d': 'Free 3D', 'walk.modeReal': 'Photoreal', 'walk.soon': 'Coming soon',
  'walk.settings': 'Settings', 'walk.map': 'Map', 'walk.zoomIn': 'Zoom in', 'walk.zoomOut': 'See more', 'walk.help.pinch': 'Pinch to see more or zoom in',
};
// Driving strings in all 8 site languages (used when the site's i18n has no such key).
const LOCAL_CAR = {};
const CAR_TXT = {
  en: { lights: 'Headlights', sound: 'Engine sound', edge: 'Edge of the site — turn back', enter: 'Enter car', exit: 'Exit car', cockpit: 'Cockpit view', chase: 'Chase view', gas: 'Accelerate', brake: 'Brake / reverse', steer: 'Steer', outside: 'Outside', driving: 'Driving', limit: 'Speed limit', hint: 'W / ↑ accelerate · S / ↓ brake & reverse · A D / ← → steer · C camera · L lights · M sound · F exit', tapCar: 'Tap a car to drive it' },
  he: { lights: 'פנסים', sound: 'צליל מנוע', edge: 'גבול האתר — הסתובבו', enter: 'היכנסו לרכב', exit: 'יציאה מהרכב', cockpit: 'מבט מתא הנהג', chase: 'מבט מאחור', gas: 'האצה', brake: 'בלם / רוורס', steer: 'היגוי', outside: 'בחוץ', driving: 'בנהיגה', limit: 'מהירות מרבית', hint: 'W / ↑ האצה · S / ↓ בלם ורוורס · A D / ← → היגוי · C מצלמה · L פנסים · M צליל · F יציאה', tapCar: 'הקישו על רכב כדי לנהוג בו' },
  ru: { lights: 'Фары', sound: 'Звук мотора', edge: 'Граница территории — разворачивайтесь', enter: 'Сесть в машину', exit: 'Выйти из машины', cockpit: 'Вид из салона', chase: 'Вид сзади', gas: 'Газ', brake: 'Тормоз / назад', steer: 'Руль', outside: 'Улица', driving: 'За рулём', limit: 'Ограничение скорости', hint: 'W / ↑ газ · S / ↓ тормоз и задний ход · A D / ← → руль · C камера · L фары · M звук · F выйти', tapCar: 'Нажмите на машину, чтобы сесть за руль' },
  uk: { lights: 'Фари', sound: 'Звук двигуна', edge: 'Межа території — розвертайтеся', enter: 'Сісти в авто', exit: 'Вийти з авто', cockpit: 'Вигляд із салону', chase: 'Вигляд ззаду', gas: 'Газ', brake: 'Гальмо / назад', steer: 'Кермо', outside: 'Надворі', driving: 'За кермом', limit: 'Обмеження швидкості', hint: 'W / ↑ газ · S / ↓ гальмо й задній хід · A D / ← → кермо · C камера · L фари · M звук · F вийти', tapCar: 'Торкніться авто, щоб сісти за кермо' },
  ro: { lights: 'Faruri', sound: 'Sunet motor', edge: 'Limita zonei — întoarceți', enter: 'Urcă în mașină', exit: 'Coboară din mașină', cockpit: 'Vedere din habitaclu', chase: 'Vedere din spate', gas: 'Accelerează', brake: 'Frână / marșarier', steer: 'Volan', outside: 'Afară', driving: 'La volan', limit: 'Limită de viteză', hint: 'W / ↑ accelerează · S / ↓ frână și marșarier · A D / ← → volan · C cameră · L faruri · M sunet · F coboară', tapCar: 'Atinge o mașină ca s-o conduci' },
  fr: { lights: 'Phares', sound: 'Son du moteur', edge: 'Limite du site — faites demi-tour', enter: 'Monter à bord', exit: 'Descendre', cockpit: 'Vue cockpit', chase: 'Vue arrière', gas: 'Accélérer', brake: 'Freiner / reculer', steer: 'Volant', outside: 'Extérieur', driving: 'Au volant', limit: 'Limitation de vitesse', hint: 'W / ↑ accélérer · S / ↓ freiner et reculer · A D / ← → volant · C caméra · L phares · M son · F descendre', tapCar: 'Touchez une voiture pour la conduire' },
  it: { lights: 'Fari', sound: 'Suono del motore', edge: 'Confine del complesso — torna indietro', enter: 'Sali a bordo', exit: 'Scendi dall’auto', cockpit: 'Vista abitacolo', chase: 'Vista esterna', gas: 'Accelera', brake: 'Freno / retro', steer: 'Sterzo', outside: 'Esterno', driving: 'Alla guida', limit: 'Limite di velocità', hint: 'W / ↑ accelera · S / ↓ freno e retromarcia · A D / ← → sterzo · C visuale · L fari · M suono · F scendi', tapCar: 'Tocca un’auto per guidarla' },
  de: { lights: 'Scheinwerfer', sound: 'Motorsound', edge: 'Grenze des Areals — bitte wenden', enter: 'Einsteigen', exit: 'Aussteigen', cockpit: 'Cockpit-Ansicht', chase: 'Verfolger-Ansicht', gas: 'Gas geben', brake: 'Bremse / rückwärts', steer: 'Lenken', outside: 'Draußen', driving: 'Am Steuer', limit: 'Tempolimit', hint: 'W / ↑ Gas · S / ↓ Bremse & rückwärts · A D / ← → lenken · C Kamera · L Licht · M Ton · F aussteigen', tapCar: 'Tippen Sie auf ein Auto, um es zu fahren' },
};
for (const [lang, o] of Object.entries(CAR_TXT)) for (const [k, v] of Object.entries(o)) {
  const key = k === 'outside' ? 'walk.outside' : 'walk.car.' + k;
  if (lang === 'en') EN[key] = v;
  (LOCAL_CAR[lang] ||= {})[key] = v;
}
// Strings introduced with the 3D lift panel / open-any-door features, in all 8 site languages
// (used only when the site's i18n has no such key).
const LOCAL = {
  en: { 'walk.mode.live': 'Live 3D', 'walk.mode.photo': 'Photo-real', 'walk.soonApt': 'Photoreal 360° is coming soon for this apartment', 'walk.mode3d': 'Free 3D', 'walk.modeReal': 'Photoreal', 'walk.soon': 'Coming soon', 'walk.reserveThis': 'Reserve this apartment', 'walk.floors': 'Floors', 'walk.tapDoor': 'Tap the door to open it', 'walk.tapKey': 'Tap a floor button on the panel', 'walk.alarm': 'Alarm bell (demo)', 'walk.roomsN': 'rooms', 'walk.status.reserved': 'Reserved', 'walk.status.sold': 'Sold' },
  he: { 'walk.mode.live': '3D חי', 'walk.mode.photo': '360° אמיתי', 'walk.soonApt': 'סיור 360° אמיתי לדירה זו יגיע בקרוב', 'walk.mode3d': '3D חופשי', 'walk.modeReal': 'מציאותי', 'walk.soon': 'בקרוב', 'walk.reserveThis': 'שריינו את הדירה הזו', 'walk.floors': 'קומות', 'walk.tapDoor': 'הקישו על הדלת כדי לפתוח אותה', 'walk.tapKey': 'הקישו על כפתור הקומה בלוח המעלית', 'walk.alarm': 'פעמון אזעקה (הדגמה)', 'walk.roomsN': 'חד׳', 'walk.status.reserved': 'משוריינת', 'walk.status.sold': 'נמכרה', 'walk.lift': 'מעלית', 'walk.floor': 'קומה', 'walk.corridor': 'מסדרון', 'walk.room.loggia': 'לוג׳יה', 'walk.room.terrace': 'מרפסת גג', 'walk.room.storage': 'מחסן', 'walk.room.dressing': 'חדר ארונות' },
  ru: { 'walk.mode.live': 'Живое 3D', 'walk.mode.photo': 'Фото 360°', 'walk.soonApt': 'Фотореалистичный 360° для этой квартиры скоро появится', 'walk.mode3d': 'Свободный 3D', 'walk.modeReal': 'Фотореализм', 'walk.soon': 'Скоро', 'walk.reserveThis': 'Забронировать эту квартиру', 'walk.floors': 'Этажи', 'walk.tapDoor': 'Нажмите на дверь, чтобы открыть', 'walk.tapKey': 'Нажмите кнопку этажа на панели', 'walk.alarm': 'Кнопка вызова (демо)', 'walk.roomsN': 'комн.', 'walk.status.reserved': 'Забронирована', 'walk.status.sold': 'Продана' },
  uk: { 'walk.mode.live': 'Живе 3D', 'walk.mode.photo': 'Фото 360°', 'walk.soonApt': 'Фотореалістичний 360° для цієї квартири незабаром', 'walk.mode3d': 'Вільний 3D', 'walk.modeReal': 'Фотореалізм', 'walk.soon': 'Незабаром', 'walk.reserveThis': 'Забронювати цю квартиру', 'walk.floors': 'Поверхи', 'walk.tapDoor': 'Торкніться дверей, щоб відчинити', 'walk.tapKey': 'Натисніть кнопку поверху на панелі', 'walk.alarm': 'Кнопка виклику (демо)', 'walk.roomsN': 'кімн.', 'walk.status.reserved': 'Заброньована', 'walk.status.sold': 'Продана' },
  ro: { 'walk.mode.live': '3D live', 'walk.mode.photo': '360° fotorealist', 'walk.soonApt': 'Turul 360° fotorealist pentru acest apartament vine în curând', 'walk.mode3d': '3D liber', 'walk.modeReal': 'Fotorealist', 'walk.soon': 'În curând', 'walk.reserveThis': 'Rezervă acest apartament', 'walk.floors': 'Etaje', 'walk.tapDoor': 'Atinge ușa pentru a o deschide', 'walk.tapKey': 'Apasă butonul etajului de pe panou', 'walk.alarm': 'Alarmă (demo)', 'walk.roomsN': 'camere', 'walk.status.reserved': 'Rezervat', 'walk.status.sold': 'Vândut' },
  fr: { 'walk.mode.live': '3D en direct', 'walk.mode.photo': '360° photoréaliste', 'walk.soonApt': 'Le 360° photoréaliste de cet appartement arrive bientôt', 'walk.mode3d': '3D libre', 'walk.modeReal': 'Photoréaliste', 'walk.soon': 'Bientôt', 'walk.reserveThis': 'Réserver cet appartement', 'walk.floors': 'Étages', 'walk.tapDoor': 'Touchez la porte pour l’ouvrir', 'walk.tapKey': 'Appuyez sur un bouton d’étage du panneau', 'walk.alarm': 'Alarme (démo)', 'walk.roomsN': 'pièces', 'walk.status.reserved': 'Réservé', 'walk.status.sold': 'Vendu' },
  it: { 'walk.mode.live': '3D dal vivo', 'walk.mode.photo': '360° fotorealistico', 'walk.soonApt': 'Il 360° fotorealistico di questo appartamento arriverà presto', 'walk.mode3d': '3D libero', 'walk.modeReal': 'Fotorealistico', 'walk.soon': 'Presto disponibile', 'walk.reserveThis': 'Prenota questo appartamento', 'walk.floors': 'Piani', 'walk.tapDoor': 'Tocca la porta per aprirla', 'walk.tapKey': 'Premi il pulsante del piano sul pannello', 'walk.alarm': 'Allarme (demo)', 'walk.roomsN': 'locali', 'walk.status.reserved': 'Riservato', 'walk.status.sold': 'Venduto' },
  de: { 'walk.mode.live': 'Live-3D', 'walk.mode.photo': 'Fotorealistisch 360°', 'walk.soonApt': 'Fotorealistisches 360° für diese Wohnung folgt in Kürze', 'walk.mode3d': 'Freies 3D', 'walk.modeReal': 'Fotorealistisch', 'walk.soon': 'Demnächst', 'walk.reserveThis': 'Diese Wohnung reservieren', 'walk.floors': 'Etagen', 'walk.tapDoor': 'Tippen Sie auf die Tür, um sie zu öffnen', 'walk.tapKey': 'Tippen Sie auf eine Etagentaste', 'walk.alarm': 'Notruf (Demo)', 'walk.roomsN': 'Zimmer', 'walk.status.reserved': 'Reserviert', 'walk.status.sold': 'Verkauft' },
};
// Balcony / loggia / terrace doors open on approach or on tap: first-time hint, all 8 site languages.
const BALCONY_DOOR_TXT = {
  en: 'Balcony doors open as you approach — or tap a door to open and close it',
  he: 'דלתות המרפסת נפתחות כשמתקרבים אליהן — אפשר גם להקיש על הדלת כדי לפתוח ולסגור',
  ro: 'Ușile de balcon se deschid când vă apropiați — sau atingeți ușa pentru a o deschide și închide',
  ru: 'Балконные двери открываются, когда вы подходите, — или нажмите на дверь, чтобы открыть и закрыть её',
  uk: 'Балконні двері відчиняються, коли ви підходите, — або торкніться дверей, щоб відчинити й зачинити їх',
  fr: 'Les portes du balcon s’ouvrent à votre approche — ou touchez la porte pour l’ouvrir et la fermer',
  it: 'Le porte del balcone si aprono quando ti avvicini — oppure tocca la porta per aprirla e chiuderla',
  de: 'Die Balkontüren öffnen sich, wenn Sie sich nähern — oder tippen Sie auf die Tür, um sie zu öffnen und zu schließen',
};
for (const [l, v] of Object.entries(BALCONY_DOOR_TXT)) (LOCAL[l] ||= {})['walk.balconyDoorHint'] = v;
// Doorbells, the apartment door-entry monitor and the entrance video intercom: all 8 site languages.
const BELL_TXT = {
  uk: { entrance: 'Вхід', 'bell.ring': 'Дзвонимо до квартири {n}…', 'bell.hint': 'Подзвоніть у дзвінок біля дверей', 'mon.open': 'Двері відчинено',
    'ic.title': 'Домофон', 'ic.prompt': 'Введіть номер квартири', 'ic.range': 'Квартири {a}–{b}', 'ic.stair': 'У цьому будинку', 'ic.call': 'Виклик', 'ic.del': 'Стерти',
    'ic.concierge': 'Викликати консьєржа', 'ic.mine': 'Моя квартира', 'ic.calling': 'Викликаємо квартиру {n}…', 'ic.callingCg': 'Викликаємо консьєржа…',
    'ic.answer': 'Квартира {n} відповіла — двері відчинено, заходьте.', 'ic.none': 'У цьому будинку немає квартири {n}',
    'ic.goApt': 'Пройти до цієї квартири', 'ic.enter': 'Увійти до лобі', 'ic.again': 'Інша квартира', 'ic.close': 'Закрити', 'ic.locked': 'Двері зачинено — скористайтеся домофоном поруч' },
  en: { entrance: 'Entrance', 'bell.ring': 'Ringing apartment {n}…', 'bell.hint': 'Ring the bell beside the door', 'mon.open': 'Door opened',
    'ic.title': 'Intercom', 'ic.prompt': 'Enter the apartment number', 'ic.range': 'Apartments {a}–{b}', 'ic.stair': 'This building', 'ic.call': 'Call', 'ic.del': 'Delete',
    'ic.concierge': 'Call concierge', 'ic.mine': 'My apartment', 'ic.calling': 'Calling apartment {n}…', 'ic.callingCg': 'Calling the concierge…',
    'ic.answer': 'Apartment {n} answered — the door is open, please come in.', 'ic.none': 'There is no apartment {n} in this building',
    'ic.goApt': 'Go to this apartment', 'ic.enter': 'Enter the lobby', 'ic.again': 'Another apartment', 'ic.close': 'Close', 'ic.locked': 'The door is locked — use the intercom beside it' },
  he: { entrance: 'כניסה', 'bell.ring': 'מצלצלים בדירה {n}…', 'bell.hint': 'צלצלו בפעמון שליד הדלת', 'mon.open': 'הדלת נפתחה',
    'ic.title': 'אינטרקום', 'ic.prompt': 'הקישו את מספר הדירה', 'ic.range': 'דירות {a}–{b}', 'ic.stair': 'בבניין זה', 'ic.call': 'חיוג', 'ic.del': 'מחיקה',
    'ic.concierge': 'קריאה לקונסיירז׳', 'ic.mine': 'הדירה שלי', 'ic.calling': 'מחייגים לדירה {n}…', 'ic.callingCg': 'מחייגים לקונסיירז׳…',
    'ic.answer': 'דירה {n} ענתה — הדלת פתוחה, היכנסו בבקשה.', 'ic.none': 'אין דירה {n} בבניין הזה',
    'ic.goApt': 'אל הדירה הזו', 'ic.enter': 'כניסה ללובי', 'ic.again': 'דירה אחרת', 'ic.close': 'סגירה', 'ic.locked': 'הדלת נעולה — השתמשו באינטרקום שלצידה' },
  ro: { entrance: 'Intrare', 'bell.ring': 'Sunăm la apartamentul {n}…', 'bell.hint': 'Sunați la soneria de lângă ușă', 'mon.open': 'Ușa s-a deschis',
    'ic.title': 'Interfon', 'ic.prompt': 'Introduceți numărul apartamentului', 'ic.range': 'Apartamentele {a}–{b}', 'ic.stair': 'În acest bloc', 'ic.call': 'Apelează', 'ic.del': 'Șterge',
    'ic.concierge': 'Sună la concierge', 'ic.mine': 'Apartamentul meu', 'ic.calling': 'Se apelează apartamentul {n}…', 'ic.callingCg': 'Se apelează concierge-ul…',
    'ic.answer': 'Apartamentul {n} a răspuns — ușa este deschisă, poftiți.', 'ic.none': 'Nu există apartamentul {n} în acest bloc',
    'ic.goApt': 'Mergi la acest apartament', 'ic.enter': 'Intră în hol', 'ic.again': 'Alt apartament', 'ic.close': 'Închide', 'ic.locked': 'Ușa este încuiată — folosiți interfonul de lângă ea' },
  ru: { entrance: 'Вход', 'bell.ring': 'Звоним в квартиру {n}…', 'bell.hint': 'Позвоните в звонок у двери', 'mon.open': 'Дверь открыта',
    'ic.title': 'Домофон', 'ic.prompt': 'Введите номер квартиры', 'ic.range': 'Квартиры {a}–{b}', 'ic.stair': 'В этом доме', 'ic.call': 'Вызов', 'ic.del': 'Стереть',
    'ic.concierge': 'Вызвать консьержа', 'ic.mine': 'Моя квартира', 'ic.calling': 'Вызываем квартиру {n}…', 'ic.callingCg': 'Вызываем консьержа…',
    'ic.answer': 'Квартира {n} ответила — дверь открыта, проходите.', 'ic.none': 'В этом доме нет квартиры {n}',
    'ic.goApt': 'Пройти к этой квартире', 'ic.enter': 'Войти в лобби', 'ic.again': 'Другая квартира', 'ic.close': 'Закрыть', 'ic.locked': 'Дверь заперта — воспользуйтесь домофоном рядом' },
  fr: { entrance: 'Entrée', 'bell.ring': 'On sonne à l’appartement {n}…', 'bell.hint': 'Sonnez à côté de la porte', 'mon.open': 'Porte ouverte',
    'ic.title': 'Interphone', 'ic.prompt': 'Composez le numéro de l’appartement', 'ic.range': 'Appartements {a}–{b}', 'ic.stair': 'Dans cet immeuble', 'ic.call': 'Appeler', 'ic.del': 'Effacer',
    'ic.concierge': 'Appeler le concierge', 'ic.mine': 'Mon appartement', 'ic.calling': 'Appel de l’appartement {n}…', 'ic.callingCg': 'Appel du concierge…',
    'ic.answer': 'L’appartement {n} a répondu — la porte est ouverte, entrez.', 'ic.none': 'Il n’y a pas d’appartement {n} dans cet immeuble',
    'ic.goApt': 'Aller à cet appartement', 'ic.enter': 'Entrer dans le hall', 'ic.again': 'Autre appartement', 'ic.close': 'Fermer', 'ic.locked': 'La porte est verrouillée — utilisez l’interphone à côté' },
  it: { entrance: 'Ingresso', 'bell.ring': 'Suoniamo all’appartamento {n}…', 'bell.hint': 'Suona il campanello accanto alla porta', 'mon.open': 'Porta aperta',
    'ic.title': 'Citofono', 'ic.prompt': 'Digita il numero dell’appartamento', 'ic.range': 'Appartamenti {a}–{b}', 'ic.stair': 'In questo edificio', 'ic.call': 'Chiama', 'ic.del': 'Cancella',
    'ic.concierge': 'Chiama il concierge', 'ic.mine': 'Il mio appartamento', 'ic.calling': 'Chiamata all’appartamento {n}…', 'ic.callingCg': 'Chiamata al concierge…',
    'ic.answer': 'L’appartamento {n} ha risposto — la porta è aperta, prego.', 'ic.none': 'Non esiste l’appartamento {n} in questo edificio',
    'ic.goApt': 'Vai a questo appartamento', 'ic.enter': 'Entra nella lobby', 'ic.again': 'Altro appartamento', 'ic.close': 'Chiudi', 'ic.locked': 'La porta è chiusa — usa il citofono accanto' },
  de: { entrance: 'Eingang', 'bell.ring': 'Es klingelt bei Wohnung {n}…', 'bell.hint': 'Klingeln Sie neben der Tür', 'mon.open': 'Tür geöffnet',
    'ic.title': 'Gegensprechanlage', 'ic.prompt': 'Wohnungsnummer eingeben', 'ic.range': 'Wohnungen {a}–{b}', 'ic.stair': 'In diesem Haus', 'ic.call': 'Anrufen', 'ic.del': 'Löschen',
    'ic.concierge': 'Concierge rufen', 'ic.mine': 'Meine Wohnung', 'ic.calling': 'Wohnung {n} wird gerufen…', 'ic.callingCg': 'Concierge wird gerufen…',
    'ic.answer': 'Wohnung {n} hat geöffnet — die Tür ist offen, bitte eintreten.', 'ic.none': 'In diesem Haus gibt es keine Wohnung {n}',
    'ic.goApt': 'Zu dieser Wohnung gehen', 'ic.enter': 'Lobby betreten', 'ic.again': 'Andere Wohnung', 'ic.close': 'Schließen', 'ic.locked': 'Die Tür ist verschlossen — bitte die Gegensprechanlage daneben benutzen' },
};
for (const [l, o] of Object.entries(BELL_TXT)) for (const [k, v] of Object.entries(o)) (LOCAL[l] ||= {})['walk.' + k] = v;
// Strings of this project's walkthrough that the site dictionaries do not have (see notes/T17.md, "KEYS FOR I18N").
const SITE_TXT = {
  uk: { yard: 'Двір', noModel: 'Для цієї квартири 3D-інтер’єр недоступний — показано спрощений об’єм', simple: 'Спрощений вигляд' },
  en: { yard: 'Courtyard', noModel: 'No 3D interior for this apartment — a simplified volume is shown', simple: 'Simplified view' },
  he: { yard: 'חצר', noModel: 'אין פנים תלת־ממדי לדירה זו — מוצג נפח פשוט', simple: 'תצוגה פשוטה' },
  ru: { yard: 'Двор', noModel: 'Для этой квартиры 3D-интерьер недоступен — показан упрощённый объём', simple: 'Упрощённый вид' },
  ro: { yard: 'Curte', noModel: 'Fără interior 3D pentru acest apartament — se afișează un volum simplificat', simple: 'Vedere simplificată' },
  fr: { yard: 'Cour', noModel: 'Pas d’intérieur 3D pour cet appartement — un volume simplifié est affiché', simple: 'Vue simplifiée' },
  it: { yard: 'Cortile', noModel: 'Nessun interno 3D per questo appartamento — è mostrato un volume semplificato', simple: 'Vista semplificata' },
  de: { yard: 'Innenhof', noModel: 'Kein 3D-Interieur für diese Wohnung — ein vereinfachtes Volumen wird gezeigt', simple: 'Vereinfachte Ansicht' },
};
for (const [l, o] of Object.entries(SITE_TXT)) for (const [k, v] of Object.entries(o)) (LOCAL[l] ||= {})['walk.' + k] = v;
const ENTRY_HOLD_MS = 9000, ENTRY_UNLOCK_MS = 600000, ENTRY_GRACE_MS = 25000;   // lobby doors after an intercom release / after leaving
const INTERCOM_DX = 0.95 + 0.42;   // the intercom totem stands this far beside the entrance axis (commons.js)
const BD_OPEN_R = 1.4, BD_CLOSE_R = 2.5, BD_CLOSE_S = 2, BD_REARM_R = 1.9, BD_HINT_R = 2.4;
const MAX_APTS = 2;          // apartments kept loaded at once (the farthest one is disposed)
const LIGHT_SLOTS = 8;       // fixed pool of apartment point lights → the light count never changes (no shader recompiles)
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const HFOV_MIN = 30, HFOV_MAX = 110, HFOV_PORTRAIT = 78, VFOV_LANDSCAPE = 68, HFOV_LANDSCAPE_MAX = 100, VFOV_CAP = 150;
const IDLE_FADE_MS = 4000;
const ICON_GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.04a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/></svg>';
const ICON_MAP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>';
const FALLBACK_STYLES = [
  { id: 'milano', name: { he: 'מילאנו', en: 'Milano', ru: 'Милано' } },
  { id: 'nordic', name: { he: 'נורדי', en: 'Nordic', ru: 'Нордик' } },
  { id: 'riviera', name: { he: 'ריביירה', en: 'Riviera', ru: 'Ривьера' } },
  { id: 'monaco', name: { he: 'מונאקו', en: 'Monaco', ru: 'Монако' } },
  { id: 'kyoto', name: { he: 'קיוטו', en: 'Kyoto', ru: 'Киото' } }, { id: 'paris', name: { he: 'פריז', en: 'Paris', ru: 'Париж' } },
];
const OUTDOOR = new Set(['balcony', 'loggia', 'terrace']);

// ---------- small helpers ----------
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const lerpN = (a, b, t) => a + (b - a) * t;
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const yawFromDir = (dx, dz) => Math.atan2(-dx, -dz);
// (worldToLocal comes from data.js)
function localToWorldXZ(bId, x, z) {
  const b = BUILDINGS[bId], c = Math.cos(b.rotY), s = Math.sin(b.rotY);
  return [b.origin[0] + x * c + z * s, b.origin[1] - x * s + z * c];
}
function dirToWorld(bId, dx, dz) { const r = BUILDINGS[bId].rotY, c = Math.cos(r), s = Math.sin(r); return [dx * c + dz * s, -dx * s + dz * c]; }
function localToUnit(unit, x, z) {
  const f = unit.frame, dx = x - f.o[0], dz = z - f.o[1];
  return [dx * f.U[0] + dz * f.U[1], dx * f.V[0] + dz * f.V[1]];
}
function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// distance from a point to an axis-aligned rect {x0,x1,z0,z1} (0 inside)
function rectDist(r, x, z) { return Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1)); }
function bboxOf(pts) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } return { x0, x1, z0, z1 }; }
function polyCentroid(poly) { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }
function isTouchDevice() { return (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window; }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function disposeMaterial(m) {
  if (!m) return;
  for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
  if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) u.value.dispose();
  m.dispose();
}
function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMaterial);
    if (o.isInstancedMesh && o.dispose) o.dispose();
  });
}
function tween(dur, fn) {
  return new Promise(res => {
    const t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / dur); fn(k < 1 ? k * k * (3 - 2 * k) : 1); k < 1 ? requestAnimationFrame(step) : res(); };
    step();
  });
}

// Load the sibling modules; any that is missing or throws is replaced by null (the walkthrough degrades gracefully).
async function loadModules(injected = {}) {
  const out = { ...injected };
  const tryImport = async (key, path) => {
    if (out[key]) return;
    try { out[key] = await import(path); } catch (e) { console.warn(`[walk] ${path} unavailable — continuing without it`, e); out[key] = null; }
  };
  await Promise.all([
    tryImport('environment', './environment.js'), tryImport('exterior', './exterior.js'),
    tryImport('apartment', './apartment.js'), tryImport('commons', './commons.js'), tryImport('materials', './materials.js'),
    tryImport('cars', './cars.js'),
  ]);
  return out;
}

// ---------- fast start: pre-warm + streaming (loading flow only) ----------
// The walkthrough opens on the apartment alone; corridor/lifts, then sky/neighbourhood, exterior and cars stream
// in right after the first frame. The final light set is reserved from the start with zero-intensity stand-ins
// ("ghosts", swapped 1:1 for the real lights as they arrive), and the fog type is set up front — so the shader
// programs compiled for the first frame stay valid and nothing recompiles when the world arrives.
// prewarmWalk() (called by the page in idle time) loads the modules, gets the textures from the worker, builds the
// target apartment and compiles its programs into a spare renderer that the next Walkthrough adopts.
// ---- apartment door-entry monitor: a slim black-glass video panel on the hall wall beside the entrance door. Built
// here as an overlay (shared geometry / materials, 2 draw calls per loaded apartment); the screen is unlit.
const MON = {};
function monitorTex(ring) {
  const W = 512, H = 370, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), TAU = Math.PI * 2;
  g.fillStyle = '#070709'; g.fillRect(0, 0, W, H);
  const sx = 14, sy = 12, sw = 484, sh = 268, vx = sx + sw / 2, vy = sy + sh * 0.42, ew = 46, eh = 30;
  const quad = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
  g.save(); g.beginPath(); g.rect(sx, sy, sw, sh); g.clip();
  // the corridor as the door camera sees it: walls, ceiling cove, runner and the neighbours' doors converge on one point
  const wl = g.createLinearGradient(sx, 0, sx + sw, 0);
  wl.addColorStop(0, '#8d7a62'); wl.addColorStop(0.42, '#3c3228'); wl.addColorStop(0.58, '#3c3228'); wl.addColorStop(1, '#8d7a62');
  g.fillStyle = wl; g.fillRect(sx, sy, sw, sh);
  quad([[sx, sy], [sx + sw, sy], [vx + ew, vy - eh], [vx - ew, vy - eh]], '#d8cdb8');
  quad([[sx, sy + sh], [sx + sw, sy + sh], [vx + ew, vy + eh], [vx - ew, vy + eh]], '#b3a691');
  quad([[sx + sw * 0.3, sy + sh], [sx + sw * 0.7, sy + sh], [vx + ew * 0.4, vy + eh], [vx - ew * 0.4, vy + eh]], '#39445a');
  quad([[vx - ew, vy - eh], [vx + ew, vy - eh], [vx + ew, vy + eh], [vx - ew, vy + eh]], '#2a231c');
  quad([[vx - 14, vy - 20], [vx + 14, vy - 20], [vx + 14, vy + 22], [vx - 14, vy + 22]], '#9db4c9');
  for (const s of [-1, 1]) {
    const ex = s < 0 ? sx : sx + sw, X = t => ex + (vx + s * ew - ex) * t, Yt = t => sy + (vy - eh - sy) * t, Yb = t => sy + sh + (vy + eh - sy - sh) * t;
    for (const [t0, t1] of [[0.2, 0.42], [0.58, 0.7], [0.8, 0.86]]) {
      const top = t => Yt(t) + (Yb(t) - Yt(t)) * 0.2;
      quad([[X(t0), top(t0)], [X(t1), top(t1)], [X(t1), Yb(t1)], [X(t0), Yb(t0)]], '#2b1c12');
      g.fillStyle = '#d9b46c'; g.fillRect(X(t1) - s * 6 - 2, (top(t1) + Yb(t1)) / 2, 4, 4);
    }
    g.strokeStyle = 'rgba(255,224,176,0.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(0), Yt(0) + 14); g.lineTo(X(1), Yt(1) + 2); g.stroke();
  }
  if (ring) {   // a visitor at the door
    g.fillStyle = '#17120e'; g.beginPath(); g.arc(vx + 6, sy + 128, 46, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(vx + 6, sy + sh + 30, 128, 104, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,214,150,0.55)'; g.lineWidth = 3; g.beginPath(); g.arc(vx + 6, sy + 128, 46, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  }
  const vg = g.createRadialGradient(vx, sy + sh / 2, sh * 0.35, vx, sy + sh / 2, sw * 0.68);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, ring ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.72)');
  g.fillStyle = vg; g.fillRect(sx, sy, sw, sh);
  if (!ring) { g.fillStyle = 'rgba(8,12,20,0.38)'; g.fillRect(sx, sy, sw, sh); }
  g.fillStyle = '#ff5346'; g.beginPath(); g.arc(sx + 22, sy + 22, 6, 0, TAU); g.fill();
  if (ring) {   // bell badge with sound arcs
    const bx = sx + sw - 46, by = sy + 44;
    g.fillStyle = '#f0cf8a'; g.beginPath(); g.arc(bx, by + 4, 15, Math.PI, TAU); g.lineTo(bx + 19, by + 14); g.lineTo(bx - 19, by + 14); g.closePath(); g.fill();
    g.beginPath(); g.arc(bx, by + 19, 4.5, 0, TAU); g.fill();
    g.strokeStyle = '#f0cf8a'; g.lineWidth = 3;
    for (const r of [26, 35]) for (const s of [-1, 1]) { g.beginPath(); g.arc(bx, by + 2, r, s < 0 ? Math.PI * 1.08 : Math.PI * 1.72, s < 0 ? Math.PI * 1.28 : Math.PI * 1.92); g.stroke(); }
  }
  g.restore();
  g.strokeStyle = ring ? '#e6c987' : '#3a3a42'; g.lineWidth = 2; g.strokeRect(sx, sy, sw, sh);
  // keys: speaker · door release (brass) · mute
  const ky = 326;
  for (const [x, main] of [[176, 0], [256, 1], [336, 0]]) {
    g.beginPath(); g.arc(x, ky, main ? 27 : 21, 0, TAU);
    if (main) { const gr = g.createLinearGradient(x - 27, ky - 27, x + 27, ky + 27); gr.addColorStop(0, '#f3dca0'); gr.addColorStop(1, '#a87f3c'); g.fillStyle = gr; g.fill(); }
    else { g.fillStyle = '#17171b'; g.fill(); g.strokeStyle = '#5a5a64'; g.lineWidth = 2; g.stroke(); }
  }
  g.strokeStyle = '#20160a'; g.fillStyle = '#20160a'; g.lineWidth = 4; g.lineCap = 'round';   // key glyph
  g.beginPath(); g.arc(247, ky, 7, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(254, ky); g.lineTo(272, ky); g.moveTo(266, ky); g.lineTo(266, ky + 7); g.moveTo(272, ky); g.lineTo(272, ky + 6); g.stroke();
  g.fillStyle = '#b9b9c4'; g.strokeStyle = '#b9b9c4'; g.lineWidth = 2.5;
  quad([[166, ky - 4], [171, ky - 4], [178, ky - 10], [178, ky + 10], [171, ky + 4], [166, ky + 4]], '#b9b9c4');
  g.beginPath(); g.arc(178, ky, 8, -0.8, 0.8); g.stroke();
  g.beginPath(); g.arc(336, ky + 1, 8, Math.PI, TAU); g.lineTo(346, ky + 6); g.lineTo(326, ky + 6); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(325, ky - 11); g.lineTo(347, ky + 11); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function monitorParts() {
  if (MON.body) return MON;
  MON.body = new THREE.BoxGeometry(0.24, 0.178, 0.02).translate(0, 0, 0.01);
  MON.face = new THREE.PlaneGeometry(0.226, 0.1635).translate(0, 0, 0.0206);
  MON.shell = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.16, metalness: 0.45, envMapIntensity: 1.1 });
  MON.idle = new THREE.MeshBasicMaterial({ map: monitorTex(false), color: 0xd8d8d8 });
  MON.ring = new THREE.MeshBasicMaterial({ map: monitorTex(true), color: 0xffffff });
  return MON;
}
const mark = n => { try { performance.mark('walk:' + n); } catch { /* old browsers */ } };
const GHOSTS = { PointLight: 5, HemisphereLight: 2, DirectionalLight: 1, SpotLight: 1 };   // commons rig + sky + car headlights
const LIGHT_TOTALS = { ...GHOSTS, PointLight: GHOSTS.PointLight + LIGHT_SLOTS };   // + the apartment light pool
function makeGhosts() {
  const out = [];
  for (const [type, n] of Object.entries(GHOSTS)) for (let i = 0; i < n; i++) {
    const l = new THREE[type](); l.intensity = 0; l.name = 'walk-ghost-light'; l.userData._ghost = type; out.push(l);
  }
  return out;
}
const FOG_PLACEHOLDER = () => new THREE.FogExp2(0x0b0d14, 0);
let SPARE = null;                   // { renderer, roomEnv } — compiled programs live in its GL context
const PREBUILT = new Map();         // `${unitId}|${styleId}` → apartment built during pre-warm (taken by _loadApt)
let _modsP = null, _warmTok = 0;
const idle = (timeout = 400) => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(r, { timeout }) : setTimeout(r, 30)));
function makeRenderer() { return new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
function roomEnvFor(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const tex = pm.fromScene(room, 0.04).texture;
  room.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
  pm.dispose();
  return tex;
}
/** Load the walkthrough's modules (cached; also used by the page to warm the HTTP/module cache). */
export function preloadWalkModules() { return (_modsP ||= loadModules()); }
/** Cancel an unfinished pre-warm (the page calls this when the walkthrough opens). */
export function cancelPrewarm() { _warmTok++; }
/**
 * Idle-time pre-warm for one apartment: modules → textures (worker) → apartment build → shader programs, each step in
 * its own idle slot; stops early when cancelled. Safe to call repeatedly (a newer call supersedes an older one).
 */
export async function prewarmWalk({ unitId, styleId = 'milano', shaders = true } = {}) {
  const tok = ++_warmTok, live = () => tok === _warmTok;
  try {
    const M = await preloadWalkModules();
    if (!live() || !M.materials) return false;
    if (M.materials.prewarmTextures) await M.materials.prewarmTextures(styleId);
    const unit = unitId && unitById(unitId);
    if (!live() || !shaders || !unit || unit.walk === false || !M.apartment || !M.apartment.buildApartment) return true;
    const key = unit.id + '|' + styleId;
    await idle(); if (!live()) return false;
    if (!M.materials.hasMaterials || !M.materials.hasMaterials(styleId)) { M.materials.getMaterials(styleId); await idle(); if (!live()) return false; }
    let apt = PREBUILT.get(key);
    if (!apt) {
      PREBUILT.clear();                                   // keep one: the apartment whose panel is open
      apt = M.apartment.buildApartment(unit, styleId, {});
      if (!apt || !apt.group) return false;
      PREBUILT.set(key, apt);
    }
    await idle(); if (!live()) return false;
    if (SPARE && SPARE.slow) return true;
    if (!SPARE) {
      const renderer = makeRenderer();
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = false;
      SPARE = { renderer, roomEnv: roomEnvFor(renderer), done: new Set() };
      await idle(); if (!live()) return false;
    }
    // A scene with the walkthrough's first-frame state: same light set, fog type and interior IBL → same programs.
    const r = SPARE.renderer, scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(70, 1, 0.08, 6000);
    scene.fog = FOG_PLACEHOLDER(); scene.environment = SPARE.roomEnv;
    for (let i = 0; i < LIGHT_TOTALS.PointLight - GHOSTS.PointLight; i++) scene.add(new THREE.PointLight(0xffe2b8, 0, 7.5, 1.6));
    for (const g of makeGhosts()) scene.add(g);
    {   // (compile() takes the lights from `scene` + the proxy only: the apartment's own lamps are not counted)
      // One not-yet-compiled material per idle slot (a compile can block the main thread briefly). A shallow clone
      // stands in for the mesh (same geometry, material and instancing → same program), so the apartment is untouched.
      const sig = o => (o.isInstancedMesh ? 'i' : '') + (o.instanceColor ? 'c' : '') + (o.geometry && o.geometry.attributes.color ? 'v' : '') + (o.isSkinnedMesh ? 's' : '');
      const todo = new Map(), shown = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
      apt.group.traverse(o => {
        if (!o.material || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const k = mats.map(m => m.uuid).join(',') + '|' + sig(o);
        if (!SPARE.done.has(k) && !todo.has(k)) todo.set(k, o);
      });
      // What the first frame shows comes first; closed-cabinet contents etc. after. Each material is DRAWN once into
      // the 1×1 spare canvas: many drivers (and software GL) only finish a program at its first draw, and the draw
      // also uploads its textures and geometry — all of which the walkthrough then reuses (same GL context).
      const order = [...todo].sort((a, b) => shown(b[1]) - shown(a[1]));
      const gl = r.getContext(), gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const A = Math.min(r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 1, isTouchDevice() ? 8 : 16);
      const KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'emissiveMap', 'clearcoatNormalMap'];
      r.setPixelRatio(1); r.setSize(1, 1, false);
      for (const [k, o] of order) {
        await idle(600); if (!live()) return false;
        const t0 = performance.now(), proxy = o.clone(false);
        proxy.frustumCulled = false; proxy.visible = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const kk of KEYS) {   // = Walkthrough._polish
          const t = m && m[kk]; if (t && t.isTexture && !(t.isDataTexture && !t.generateMipmaps) && t.anisotropy < A && !t.userData._aniso) { t.userData._aniso = true; t.anisotropy = A; }
        }
        scene.add(proxy);
        try { r.render(scene, cam); } catch (e) { /* optional warm-up */ }
        scene.remove(proxy);
        if (proxy.isInstancedMesh && proxy.dispose) proxy.dispose();
        SPARE.done.add(k);
        // Wait (without blocking) until the GPU has really finished this one before queueing the next: a slow GPU or
        // software GL then never builds up a backlog the walkthrough's first frame would have to wait for.
        if (gl2) {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
          while (sync && gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) { await new Promise(res => setTimeout(res, 16)); if (!live()) { gl.deleteSync(sync); return false; } }
          if (sync) gl.deleteSync(sync);
        }
        if (performance.now() - t0 > 1500) { SPARE.slow = true; break; }   // software GL / very slow GPU: stop here
      }
      return true;
    }
  } catch (e) { console.info('[walk] pre-warm skipped:', e && e.message); return false; }
}

// ---------- HUD stylesheet (scoped under .vw) ----------
const CSS = `
.vw{position:absolute;inset:0;overflow:hidden;background:#050505;color:#f3ead7;font-family:"Manrope","Inter Tight","Heebo","Assistant",system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:pan-x;-webkit-text-size-adjust:100%;
  --g:#c9a45c;--g2:#e6c987;--bg:rgba(8,8,8,.66);--ln:rgba(201,164,92,.40);
  --sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px);--st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px)}
.vw canvas.vw-gl{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;cursor:grab}
.vw canvas.vw-gl.drag{cursor:grabbing}.vw canvas.vw-gl.act{cursor:pointer}
.vw-hud{position:absolute;inset:0;pointer-events:none}
.vw-hud>*{pointer-events:auto}
:where(.vw) button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.vw-panel{background:var(--bg);-webkit-backdrop-filter:blur(12px) saturate(1.2);backdrop-filter:blur(12px) saturate(1.2);border:1px solid var(--ln);border-radius:12px}
.vw-top,.vw-tools,.vw-map,.vw-mapbtn,.vw-pad,.vw-bottom,.vw-lift{transition:opacity .45s ease}
.vw-top{position:absolute;top:calc(10px + var(--st));left:calc(10px + var(--sl));right:calc(10px + var(--sr));display:flex;gap:8px;align-items:flex-start;justify-content:space-between;pointer-events:none}
.vw-top>*{pointer-events:auto}
.vw-title{padding:7px 12px;min-width:0;max-width:min(58vw,460px)}
.vw-title .t1{unicode-bidi:plaintext;text-align:start;font-family:"Cormorant Garamond","Bodoni Moda",Georgia,serif;font-size:15px;letter-spacing:.04em;color:var(--g2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vw-title .t2{font-size:11.5px;opacity:.88;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vw-title .t2 b{color:var(--g);font-weight:600}
.vw-actions{display:flex;gap:7px;flex-shrink:0}
.vw-btn{height:34px;padding:0 13px;border-radius:999px;display:inline-flex;align-items:center;gap:7px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;touch-action:manipulation}
.vw-gold{background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111;font-weight:700;box-shadow:0 5px 16px rgba(201,164,92,.22)}
.vw-ghost{background:var(--bg);border:1px solid var(--ln);color:#f3ead7;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.vw-ghost:hover{border-color:var(--g)}
.vw-ghost.on{border-color:var(--g);color:var(--g2);background:rgba(201,164,92,.16)}
.vw-price{font-weight:500;opacity:.8;letter-spacing:0;text-transform:none}
.vw-icon{width:34px;padding:0;justify-content:center}
.vw-gear{display:none}
.vw-tools{position:absolute;top:calc(58px + var(--st));right:calc(10px + var(--sr));display:flex;flex-direction:column;gap:7px;align-items:stretch;padding:7px;width:112px}
.vw[dir=rtl] .vw-tools{right:auto;left:calc(10px + var(--sl))}
.vw-seg{display:flex;border:1px solid var(--ln);border-radius:999px;overflow:hidden}
.vw-seg button{flex:1;padding:6px 0;font-size:11px;letter-spacing:.04em;color:#d9ccb0;touch-action:manipulation}
.vw-seg button.on{background:var(--g);color:#111;font-weight:700}
.vw-zoom{direction:ltr;align-items:center}
.vw-zoom button{font-size:15px;line-height:1;padding:4px 0;color:var(--g2)}
.vw-zoom button:active{background:rgba(201,164,92,.25)}
.vw-zoom .zv{flex:1.1;text-align:center;font-size:10.5px;letter-spacing:.04em;color:#e9dfc8;font-variant-numeric:tabular-nums}
.vw-tlabel{text-align:start;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--g);opacity:.9;padding:2px 4px 0}
.vw-styles{display:flex;flex-direction:column;gap:3px}
.vw-styles button{text-align:start;padding:5px 9px;border-radius:8px;font-size:11.5px;border:1px solid transparent;color:#e9dfc8}
.vw-styles button.on{border-color:var(--g);color:var(--g2);background:rgba(201,164,92,.10)}
.vw-prow{display:none}
.vw-bottom{position:absolute;bottom:calc(10px + var(--sb));left:calc(10px + var(--sl));right:calc(10px + var(--sr));display:flex;flex-direction:column;gap:6px;pointer-events:none}
.vw-row{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;pointer-events:auto;padding:1px;max-width:100%;align-self:center;touch-action:pan-x}
.vw-row::-webkit-scrollbar,.vw-bottom::-webkit-scrollbar{display:none}
.vw-chip{flex-shrink:0;height:30px;padding:0 12px;border-radius:999px;font-size:11.5px;white-space:nowrap;background:var(--bg);border:1px solid var(--ln);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);color:#efe5cf;touch-action:pan-x}
.vw-chip:hover{border-color:var(--g)}
.vw-chip.on{background:var(--g);border-color:var(--g);color:#111;font-weight:700}
.vw-chip.tp{border-style:dashed}
.vw-map{position:absolute;inset-inline-start:calc(10px + var(--sl));bottom:calc(88px + var(--sb));padding:5px;border-radius:11px}
.vw-map canvas{display:block;width:170px;height:106px;border-radius:7px;cursor:pointer}
.vw-mapbtn{display:none}
.vw-pad{position:absolute;right:calc(12px + var(--sr));bottom:calc(88px + var(--sb));width:112px;height:112px;display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);gap:4px;direction:ltr}
.vw[dir=rtl] .vw-pad{right:auto;left:calc(12px + var(--sl))}
.vw-pad button{border-radius:11px;background:var(--bg);border:1px solid var(--ln);color:var(--g2);font-size:15px;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);touch-action:none}
.vw-pad button.on{background:var(--g);color:#111}
.vw-pad .u{grid-area:1/2}.vw-pad .l{grid-area:2/1}.vw-pad .r{grid-area:2/3}.vw-pad .d{grid-area:3/2}
.vw-lift{position:absolute;inset-inline-end:136px;bottom:calc(88px + var(--sb));padding:9px;width:152px;display:none}
.vw-lift.show{display:block}
.vw-lift .hd{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--g);margin-bottom:7px;display:flex;justify-content:space-between;align-items:center}
.vw-lift .ind{font-family:"Cormorant Garamond",Georgia,serif;font-size:19px;color:var(--g2);letter-spacing:0;white-space:nowrap}
.vw-lift .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;direction:ltr}
.vw-lift .grid button{height:29px;border-radius:50%;aspect-ratio:1;border:1px solid var(--ln);font-size:11px;color:#efe5cf;justify-self:center;touch-action:manipulation}
.vw-lift .grid button.on{background:var(--g);color:#111;box-shadow:0 0 12px rgba(230,201,135,.7)}
.vw-lift .grid button.here{border-color:var(--g2);color:var(--g2)}
.vw-toast{position:absolute;top:calc(64px + var(--st));left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:999px;font-size:12px;opacity:0;transition:opacity .3s;pointer-events:none;white-space:nowrap}
.vw-toast.show{opacity:1}
.vw-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .28s}
.vw-loading{position:absolute;inset:0;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#15120c 0%,#050505 70%);transition:opacity .5s;z-index:5}
.vw-loading.hide{opacity:0;pointer-events:none}
.vw-loading .ring{width:46px;height:46px;border-radius:50%;border:1.5px solid rgba(201,164,92,.25);border-top-color:var(--g);animation:vwspin 1s linear infinite}
.vw-loading .lt{font-family:"Cormorant Garamond",Georgia,serif;font-size:19px;letter-spacing:.08em;color:var(--g2)}
@keyframes vwspin{to{transform:rotate(360deg)}}
.vw-help{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:4}
.vw-help.show{display:flex}
.vw-help .card{max-width:min(420px,calc(100% - 32px));padding:24px 24px 20px;border-radius:18px;background:rgba(10,10,10,.92);border:1px solid var(--ln)}
.vw-help h3{margin:0 0 14px;font-family:"Cormorant Garamond","Bodoni Moda",Georgia,serif;font-weight:500;font-size:26px;color:var(--g2);letter-spacing:.03em}
.vw-help ul{list-style:none;margin:0 0 18px;padding:0;display:flex;flex-direction:column;gap:10px}
.vw-help li{display:flex;gap:12px;align-items:center;font-size:14px;line-height:1.35}
.vw-help li i{flex:0 0 34px;height:34px;border-radius:50%;border:1px solid var(--ln);display:flex;align-items:center;justify-content:center;font-style:normal;color:var(--g);font-size:14px}
.vw-help .vw-btn{width:100%;justify-content:center;height:40px;font-size:13px}
.vw-help h3,.vw-help li span,.vw-chip,.vw-toast,.vw-styles button,.vw-title .t2,.vw-loading .lt,.vw-prow span{unicode-bidi:plaintext}
.vw-helpbtn{font-size:14px}
.vw.m360 .vw-pad .u,.vw.m360 .vw-pad .d{visibility:hidden}
.vw.riding .vw-pad,.vw.riding .vw-bottom{opacity:.35;pointer-events:none}
@media (max-width:900px){.vw-price{display:none}}

/* ---------- phones (pointer:coarse or < 700px): the 3D view comes first ---------- */
.vw.phone{--bg:rgba(10,9,7,.46);--ln:rgba(201,164,92,.34)}
.vw.phone .vw-top{top:calc(6px + var(--st));left:calc(8px + var(--sl));right:calc(8px + var(--sr));gap:6px;align-items:center}
.vw.phone .vw-title{flex:1 1 auto;max-width:none;padding:5px 11px;border-radius:12px}
.vw.phone .vw-title .brand{display:none}
.vw.phone .vw-title .t1{font-size:13.5px;line-height:1.2}
.vw.phone .vw-title .t2{font-size:10.5px;margin-top:0}
.vw.phone .vw-actions{gap:6px}
.vw.phone .vw-btn{height:38px;padding:0 12px;font-size:10.5px;letter-spacing:.05em}
.vw.phone .vw-gold{box-shadow:0 3px 10px rgba(0,0,0,.35)}
.vw.phone .vw-icon,.vw.phone .vw-exit,.vw.phone .vw-photo{width:38px;padding:0;justify-content:center}
.vw.phone .vw-exit .lbl,.vw.phone .vw-photo .lbl,.vw.phone .vw-price,.vw.phone .vw-helpbtn{display:none}
.vw.phone .vw-gear{display:inline-flex}
.vw.phone .vw-tools{display:none;position:absolute;top:calc(52px + var(--st));right:calc(8px + var(--sr));left:auto;width:212px;padding:10px;gap:9px;border-radius:16px;
  background:rgba(10,9,7,.84);box-shadow:0 14px 40px rgba(0,0,0,.5);transform-origin:top right;animation:vwpop .16s ease-out}
.vw.phone[dir=rtl] .vw-tools{left:calc(8px + var(--sl));right:auto;transform-origin:top left}
.vw.phone .vw-tools.open{display:flex}
@keyframes vwpop{from{opacity:0;transform:scale(.96) translateY(-4px)}to{opacity:1;transform:none}}
.vw.phone .vw-seg button{padding:8px 0;font-size:11.5px}
.vw.phone .vw-zoom button{font-size:17px;padding:5px 0}
.vw.phone .vw-tlabel.st{pointer-events:none}
.vw.phone .vw-tools .vw-styles{display:flex;flex-flow:row wrap;gap:5px}
.vw.phone .vw-styles button{flex:1 1 auto;text-align:center;padding:6px 8px;border-color:var(--ln);border-radius:999px;font-size:11.5px}
.vw.phone .vw-styles button.on{border-color:var(--g)}
.vw.phone .vw-prow{display:flex;align-items:center;gap:9px;padding:7px 4px 1px;border-top:1px solid rgba(201,164,92,.18);font-size:12px;color:#e9dfc8;text-align:start}
.vw.phone .vw-prow i{flex:0 0 22px;height:22px;border-radius:50%;border:1px solid var(--ln);display:flex;align-items:center;justify-content:center;font-style:normal;color:var(--g);font-size:11px}
.vw.phone .vw-bottom{bottom:calc(6px + var(--sb));left:var(--sl);right:var(--sr);flex-direction:row;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:none;padding:1px 8px;pointer-events:auto;touch-action:pan-x;overscroll-behavior-x:contain;
  -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 10px,#000 calc(100% - 10px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 10px,#000 calc(100% - 10px),transparent 100%)}
.vw.phone .vw-row{overflow:visible;flex-shrink:0;align-self:auto;max-width:none;padding:0;gap:6px}
.vw.phone .vw-tp{padding-inline-start:7px;border-inline-start:1px solid rgba(201,164,92,.3)}
.vw.phone .vw-tp:empty,.vw.phone .vw-rooms:empty{display:none}
.vw.phone .vw-chip{height:32px;padding:0 12px;font-size:11.5px}
.vw.phone .vw-map{bottom:calc(46px + var(--sb));inset-inline-start:calc(8px + var(--sl));padding:3px;border-radius:10px}
.vw.phone .vw-map canvas{width:96px;height:68px;border-radius:7px}
.vw.phone.mapoff .vw-map{display:none}
.vw.phone.mapoff .vw-mapbtn{display:flex;position:absolute;bottom:calc(46px + var(--sb));inset-inline-start:calc(8px + var(--sl));width:38px;height:38px;border-radius:50%;
  align-items:center;justify-content:center;color:var(--g2);padding:0}
.vw.phone .vw-pad{bottom:calc(46px + var(--sb));right:calc(8px + var(--sr));width:118px;height:78px;grid-template:repeat(2,1fr)/repeat(3,1fr);gap:4px}
.vw.phone[dir=rtl] .vw-pad{right:auto;left:calc(8px + var(--sl))}
.vw.phone .vw-pad button{border-radius:10px;font-size:13px}
.vw.phone .vw-pad .d{grid-area:2/2}
.vw.phone.incar .vw-map,.vw.phone.incar .vw-mapbtn{display:none}
.vw.phone .vw-lift{left:calc(8px + var(--sl));right:calc(8px + var(--sr));bottom:calc(46px + var(--sb));width:auto;padding:8px 10px;border-radius:14px}
.vw.phone .vw-lift.show{display:flex;align-items:center;justify-content:center;gap:10px}
.vw.phone .vw-lift .hd{flex-direction:column;align-items:center;justify-content:center;margin:0;min-width:46px;gap:2px;font-size:9px}
.vw.phone .vw-lift .ind{font-size:22px;line-height:1}
.vw.phone .vw-lift .grid{grid-template-columns:repeat(6,40px);gap:6px}
.vw.phone .vw-lift .grid button{width:40px;height:40px;font-size:13px;background:rgba(0,0,0,.25)}
.vw.phone .vw-lift .grid button.on{background:var(--g)}
.vw.phone .vw-toast{top:calc(54px + var(--st));font-size:11.5px}
/* fallback 2D floor grid: hidden by default, opened from the small "Floors" button while in the car */
.vw-floorsbtn{display:none;position:absolute;inset-inline-end:calc(136px + var(--sr));bottom:calc(88px + var(--sb));height:34px;padding:0 12px;border-radius:999px;align-items:center;gap:6px;font-size:11px;letter-spacing:.06em;color:var(--g2);transition:opacity .45s}
.vw.incar .vw-floorsbtn,.vw.riding .vw-floorsbtn{display:inline-flex}
.vw-floorsbtn.on{background:rgba(201,164,92,.22);border-color:var(--g)}
.vw.phone .vw-floorsbtn{inset-inline-end:auto;inset-inline-start:calc(8px + var(--sl));bottom:calc(46px + var(--sb));height:36px}
.vw.phone.incar .vw-lift.show{bottom:calc(88px + var(--sb))}
/* unit card: label + price + reserve chip for the apartment you're in */
.vw-ucard{position:absolute;top:calc(60px + var(--st));left:50%;transform:translate(-50%,-6px);display:flex;align-items:center;gap:12px;padding:8px 8px 8px 14px;border-radius:16px;opacity:0;pointer-events:none;transition:opacity .35s,transform .35s;max-width:calc(100% - 20px)}
.vw[dir=rtl] .vw-ucard{padding:8px 14px 8px 8px}
.vw-ucard.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.vw-ucard .ut{min-width:0}
.vw-ucard .u1{font-family:"Cormorant Garamond","Bodoni Moda",Georgia,serif;font-size:15px;color:var(--g2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;text-align:start}
.vw-ucard .u2{font-size:11.5px;opacity:.9;white-space:nowrap;unicode-bidi:plaintext;text-align:start}
.vw-ucard .u2 b{color:var(--g2);font-weight:600}
.vw-ucard .vw-btn{height:32px;font-size:10.5px;flex-shrink:0}
.vw.phone .vw-ucard{top:calc(52px + var(--st))}
.vw.phone.dim .vw-ucard.show{opacity:.8}
.vw-ucard.show~.vw-toast{top:calc(122px + var(--st))}
@media (min-width:600px){.vw.phone .vw-lift .grid{grid-template-columns:repeat(12,38px)}.vw.phone .vw-lift .grid button{width:38px;height:38px}}
/* auto-fade: the HUD steps back while you look/walk or after a few idle seconds; any tap brings it back */
.vw.phone.dim .vw-top,.vw.phone.dim .vw-map,.vw.phone.dim .vw-mapbtn,.vw.phone.dim .vw-bottom,.vw.phone.dim:not(.padon) .vw-pad{opacity:.15}
.vw.phone.dim.padon .vw-pad{opacity:.55}
.vw.phone.dim.riding .vw-bottom{opacity:.1}
/* view-mode switch: free 3D | photoreal panoramas (always above the pano layer) */
.vw-modes{position:absolute;top:calc(54px + var(--st));left:50%;transform:translateX(-50%);display:flex;padding:3px;gap:2px;border-radius:999px;z-index:6;transition:opacity .45s ease}
.vw-modes button{height:28px;padding:0 13px;border-radius:999px;font-size:11.5px;letter-spacing:.03em;white-space:nowrap;color:#e9dfc8;touch-action:manipulation;unicode-bidi:isolate}
.vw-modes button.on{background:linear-gradient(135deg,#e6c987,#b88a3c);color:#111;font-weight:700}
.vw-modes button.off{opacity:.45;cursor:default}
.vw-modes .soon{position:absolute;top:calc(100% + 7px);inset-inline-end:6px;padding:4px 10px;border-radius:999px;font-size:10.5px;white-space:nowrap;background:rgba(10,9,7,.9);border:1px solid var(--ln);color:var(--g2);opacity:0;transform:translateY(-3px);transition:opacity .25s,transform .25s;pointer-events:none}
.vw-modes .soon.show{opacity:1;transform:none}
.vw-modes[hidden]{display:none!important}
.vw-modes .soon:before{content:"";position:absolute;top:-4px;inset-inline-end:18px;width:7px;height:7px;background:inherit;border-left:1px solid var(--ln);border-top:1px solid var(--ln);transform:rotate(45deg)}
.vw.phone .vw-modes{top:calc(50px + var(--st))}
.vw.phone .vw-modes button{height:30px;padding:0 12px}
.vw.phone.dim:not(.pano) .vw-modes{opacity:.15}
.vw-toast{top:calc(96px + var(--st))}.vw.phone .vw-toast{top:calc(92px + var(--st))}
.vw-ucard{top:calc(96px + var(--st))}.vw.phone .vw-ucard{top:calc(90px + var(--st))}
.vw-ucard.show~.vw-toast{top:calc(158px + var(--st))}
.vw-pano{position:absolute;inset:0;z-index:3;background:#050505}
.vw-carchip{position:absolute;left:50%;bottom:calc(100px + var(--sb));transform:translateX(-50%);display:none;height:42px;padding:0 18px;font-size:12.5px;z-index:2}
.vw-carchip.show{display:inline-flex;animation:vwpop .35s ease}
@keyframes vwpop{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.vw-drive{display:none}
.vw.driving .vw-drive{display:block;position:absolute;inset:0;pointer-events:none}
.vw.driving .vw-drive>*{pointer-events:auto}
.vw.driving :is(.vw-pad,.vw-bottom,.vw-map,.vw-mapbtn,.vw-lift,.vw-floorsbtn,.vw-modes,.vw-tools,.vw-ucard,.vw-photo,.vw-helpbtn,.vw-gear,.vw-carchip){display:none!important}
.vw-dtop{position:absolute;top:calc(56px + var(--st));right:calc(10px + var(--sr));display:flex;gap:7px}
.vw[dir=rtl] .vw-dtop{right:auto;left:calc(10px + var(--sl))}
.vw-dtop .vw-ico{width:40px;padding:0;justify-content:center}
.vw-dtop .vw-ico.on{color:#111;background:linear-gradient(180deg,#f0d596,#b88a3c);border-color:transparent}
.vw-dtop [data-k=carsound] .on{display:none}.vw-dtop [data-k=carsound].on .on{display:inline}.vw-dtop [data-k=carsound].on .off{display:none}
.vw-spdo{position:absolute;left:50%;bottom:calc(14px + var(--sb));transform:translateX(-50%);width:124px;height:124px;border-radius:50%;
  background:radial-gradient(circle at 50% 40%,rgba(28,24,17,.92),rgba(6,6,6,.9) 70%);border:1px solid var(--ln);box-shadow:0 8px 28px rgba(0,0,0,.45),inset 0 0 0 4px rgba(201,164,92,.07);direction:ltr}
.vw-spdo svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(135deg)}
.vw-spdo circle{fill:none;stroke-width:4.5;stroke-linecap:round}
.vw-spdo .bg{stroke:rgba(201,164,92,.18);stroke-dasharray:141.4 200}
.vw-spdo .arc{stroke:url(#vwgold);stroke-dasharray:0 200;transition:stroke-dasharray .12s linear}
.vw-spdo.over .arc{stroke:#e0703c}
.vw-spdo .num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
.vw-spdo .num b{font-family:"Cormorant Garamond","Bodoni Moda",Georgia,serif;font-weight:500;font-size:38px;color:var(--g2);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.vw-spdo .num i{font-style:normal;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:#d9ccb0;margin-top:3px}
.vw-spdo .gear{position:absolute;left:50%;bottom:13px;transform:translateX(-50%);font-size:11px;font-weight:700;color:var(--g);letter-spacing:.1em}
.vw-spdo .lim{position:absolute;right:-8px;top:-4px;width:34px;height:34px;border-radius:50%;background:#f5f2ea;border:3.5px solid #c8231e;color:#111;
  font:700 12.5px/27px "Manrope","Inter Tight",Arial,sans-serif;text-align:center;box-shadow:0 3px 10px rgba(0,0,0,.4)}
.vw-steer,.vw-pedals{display:none;touch-action:none;-webkit-user-select:none;user-select:none;direction:ltr}
.vw.phone .vw-steer{display:flex;position:absolute;left:calc(12px + var(--sl));bottom:calc(22px + var(--sb));width:132px;height:62px;border-radius:31px;
  align-items:center;justify-content:space-between;padding:0 12px;background:var(--bg);border:1px solid var(--ln);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);color:var(--g2);font-size:13px}
.vw-steer .knob{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#f0d596,#a87c34);box-shadow:0 3px 10px rgba(0,0,0,.45);transition:transform .12s ease}
.vw-steer.on .knob{transition:none}
.vw.phone .vw-pedals{display:flex;position:absolute;right:calc(12px + var(--sr));bottom:calc(18px + var(--sb));gap:9px;align-items:flex-end}
.vw-pedals button{position:relative;border-radius:12px;border:1px solid var(--ln);background:linear-gradient(180deg,rgba(40,36,28,.9),rgba(10,10,10,.9));color:#e9dfc8;touch-action:none;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 0 7px;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.vw-pedals button i{position:absolute;inset:8px 9px 26px;border-radius:7px;background:repeating-linear-gradient(0deg,rgba(201,164,92,.55) 0 3px,transparent 3px 8px)}
.vw-pedals button span{font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;opacity:.85;max-width:100%;overflow:hidden;text-overflow:ellipsis;padding:0 3px}
.vw-pedals .brake{width:66px;height:76px}.vw-pedals .gas{width:56px;height:108px}
.vw-pedals button.on{border-color:var(--g2);background:linear-gradient(180deg,#e6c987,#b88a3c);color:#111}
.vw-pedals button.on i{background:repeating-linear-gradient(0deg,rgba(0,0,0,.35) 0 3px,transparent 3px 8px)}
.vw.phone .vw-spdo{width:104px;height:104px;bottom:calc(16px + var(--sb))}
.vw.phone .vw-spdo .num b{font-size:32px}
.vw-dhint{position:absolute;left:calc(12px + var(--sl));bottom:calc(16px + var(--sb));padding:8px 12px;font-size:11px;letter-spacing:.03em;max-width:min(360px,34vw);line-height:1.45;color:#e9dfc8}
.vw.phone .vw-dhint{display:none}
.vw.pano .vw-hud>*:not(.vw-fade):not(.vw-modes){display:none!important}
.vw.pano .vw-modes{opacity:1!important}
.vw.pano canvas.vw-gl{visibility:hidden}
.vw-cg{box-sizing:border-box;position:absolute;left:50%;bottom:calc(14px + var(--sb));width:min(380px,calc(100% - 24px));padding:12px 12px 10px;border-radius:16px;
  background:linear-gradient(180deg,rgba(22,19,14,.9),rgba(8,8,8,.9));opacity:0;transform:translate(-50%,10px) scale(.98);transition:opacity .28s ease,transform .28s ease;pointer-events:none;
  box-shadow:0 14px 40px rgba(0,0,0,.5);z-index:3}
.vw-cg.show{opacity:1;transform:translate(-50%,0) scale(1);pointer-events:auto}
.vw-cg:before{content:"";position:absolute;top:-6px;left:50%;width:11px;height:11px;margin-left:-6px;background:#16130e;border-left:1px solid var(--ln);border-top:1px solid var(--ln);transform:rotate(45deg)}
.vw-cg .hd{display:flex;align-items:center;gap:9px}
.vw-cg .av{flex:0 0 34px;height:34px;border-radius:50%;border:1px solid var(--ln);display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 35%,#2a241a,#0b0a08)}
.vw-cg .who{flex:1;min-width:0;text-align:start;line-height:1.2}
.vw-cg .who b{display:block;font-family:"Cormorant Garamond","Bodoni Moda",Georgia,serif;font-weight:600;font-size:16px;color:var(--g2);letter-spacing:.02em}
.vw-cg .who span{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--g);opacity:.9}
.vw-cg .ib{flex:0 0 32px;height:32px;border-radius:50%;border:1px solid var(--ln);display:flex;align-items:center;justify-content:center;color:var(--g2);font-size:13px}
.vw-cg .ib.on{background:rgba(201,164,92,.18);border-color:var(--g2)}
.vw-cg .msg{margin:9px 2px 10px;font-size:13.5px;line-height:1.5;color:#f3ead7;text-align:start;unicode-bidi:plaintext}
.vw-cg .acts{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.vw-cg .acts button{min-height:40px;padding:6px 10px;border-radius:11px;border:1px solid var(--ln);background:rgba(255,255,255,.03);color:#efe5cf;font-size:12.5px;line-height:1.25;text-align:start;display:flex;align-items:center;gap:7px}
.vw-cg .acts button i{font-style:normal;color:var(--g);flex:0 0 auto;font-size:13px;width:16px;text-align:center}
.vw-cg .acts button small{display:block;font-size:10.5px;opacity:.7}
.vw-cg .acts button.pri{background:linear-gradient(180deg,#e6c987,#b88a3c);color:#16110a;border-color:transparent;font-weight:600}
.vw-cg .acts button.pri i{color:#16110a}
.vw-cg .acts button.wide{grid-column:1/-1;justify-content:center;min-height:34px;background:none;border-color:transparent;color:var(--g2);font-size:12px;letter-spacing:.06em}
.vw-cg .acts.fl{grid-template-columns:repeat(4,1fr)}
.vw-cg .acts.fl button{justify-content:center;font-size:14px;min-height:40px;padding:0;text-align:center}
.vw-cg .acts.fl button.here{border-color:var(--g2);color:var(--g2);opacity:.6;cursor:default}
.vw-cg .acts.fl button.mine{background:rgba(201,164,92,.2);border-color:var(--g2)}
.vw.phone .vw-cg{bottom:calc(10px + var(--sb))}
.vw.riding .vw-cg,.vw.m360 .vw-cg{display:none}
.vw-ic .disp{display:flex;align-items:center;justify-content:center;height:44px;margin:9px 0 5px;border-radius:11px;border:1px solid var(--ln);background:linear-gradient(180deg,#0e1a2b,#1d3350);font:600 25px/1 "Manrope","Inter Tight",Arial,sans-serif;letter-spacing:.2em;color:#fff3dc;direction:ltr;transition:background .3s}
.vw-ic .disp.empty{font-size:12.5px;font-weight:400;letter-spacing:.02em;color:#b9c6d8;direction:inherit;unicode-bidi:plaintext}
.vw-ic .disp.ok{background:linear-gradient(180deg,#0d3323,#23744b)}
.vw-ic .disp.calling{animation:vwicp 1s ease-in-out infinite}
@keyframes vwicp{50%{box-shadow:0 0 0 3px rgba(230,201,135,.35);border-color:var(--g2)}}
.vw-ic .info{min-height:17px;margin:0 2px 7px;font-size:12px;line-height:1.4;color:#d9cdb2;text-align:center;unicode-bidi:plaintext}
.vw-ic .info.ok{color:#9be8bd}.vw-ic .info.err{color:#ff9d8a}
.vw-ic .lst{display:flex;align-items:center;gap:5px;overflow-x:auto;margin:0 0 7px;padding-bottom:2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.vw-ic .lst::-webkit-scrollbar{display:none}
.vw-ic .lst span{flex:0 0 auto;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--g);padding-inline-end:3px}
.vw-ic .lst button{flex:0 0 auto;min-width:40px;height:26px;padding:0 7px;border-radius:999px;border:1px solid var(--ln);background:rgba(255,255,255,.03);color:#efe5cf;font-size:11.5px}
.vw-ic .lst button.mine{border-color:var(--g2);background:rgba(201,164,92,.2);color:var(--g2)}
.vw-ic .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;direction:ltr;margin-bottom:7px}
.vw-ic .pad button{height:40px;border-radius:11px;border:1px solid var(--ln);background:rgba(255,255,255,.04);color:#fff3dc;font:600 17px/1 "Manrope","Inter Tight",Arial,sans-serif;display:flex;align-items:center;justify-content:center}
.vw-ic .pad button:active{background:rgba(201,164,92,.25)}
.vw-ic .pad button.call{background:linear-gradient(180deg,#e6c987,#b88a3c);color:#16110a;border-color:transparent}
.vw-ic .pad button.del{color:var(--g2)}
`;

export class Walkthrough {
  static get startsFromPano() { return true; }   // enter({ from: <pano-tour state> }) places the camera itself
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.i18n = opts.i18n || null;
    this.styleId = opts.styleId || 'milano';
    // building finish of the commons: an explicit choice (HUD / opts.finish) or null = follow the apartment style
    { const f = opts.finish || lsGet('vrc.walk.finish'); this.finishId = ['classic', 'grand', 'stone'].includes(f) ? f : null; }
    this.envMode = opts.timeMode || 'dusk';
    this.mode = 'walk';
    this.disposed = false;
    this.unit = null; this.bId = null; this.floor = null;
    this.apt = null; this.aptGroup = null; this.commons = null; this.liftInfos = [];
    this.loaded = new Map();         // unitId → { unit, apt, src, lights, rooms } (≤ MAX_APTS)
    this.solids = []; this.floors = []; this.actions = [];
    this.floorReq = false;           // true once real walkable floors are known → can't walk into the void
    this.player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, eye: EYE };
    this.keys = new Set(); this.pad = { u: 0, d: 0, l: 0, r: 0 };
    this.glide = null; this.riding = false; this.busy = false; this.touched360 = false;
    this.inCar = null; this._lastHud = 0; this._lastMap = 0; this._lastHover = 0;
    this._taps = null; this._pointers = new Map();
    this._ray = new THREE.Raycaster(); this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this._own = [];                 // helper objects we created (disposed by us)
    this._isTouch = isTouchDevice();
    this._zoomS = 1; this._baseTanH = Math.tan(34 * D2R); this._hfov = 70;   // zoom = scale on tan(½·horizontal FOV)
    this._pinch = null; this._phone = null; this._mapOpen = null; this._popOpen = false;
    this._lastAct = performance.now(); this._dim = false; this._suppressTap = 0;

    // DOM
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.root = document.createElement('div');
    this.root.className = 'vw';
    const style = document.createElement('style'); style.textContent = CSS; this.root.appendChild(style);
    container.appendChild(this.root);

    // renderer / scene / camera
    // A renderer pre-warmed in idle time (prewarmWalk) already holds this apartment's compiled shader programs.
    const spare = SPARE; SPARE = null; cancelPrewarm();
    this.renderer = spare ? spare.renderer : makeRenderer();
    this._spareEnv = spare ? spare.roomEnv : null;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    // Sharper floors/walls at grazing angles; phones get a lighter 8× cap.
    this._aniso = Math.min(this.renderer.capabilities.getMaxAnisotropy ? this.renderer.capabilities.getMaxAnisotropy() : 1, isTouchDevice() ? 8 : 16);
    this.canvas = this.renderer.domElement; this.canvas.className = 'vw-gl'; this.canvas.tabIndex = 0;
    this.root.appendChild(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 6000);   // near 8 cm: 60 % more depth precision than 5 cm (no far-wall z-fight)
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.clock = new THREE.Clock();

    this._buildHud();
    this._bind();
    this._resize();
    this._ready = this._init();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  // ======================= i18n =======================
  t(key, fb) {
    let s;
    try { s = this.i18n && typeof this.i18n.t === 'function' ? this.i18n.t(key) : undefined; } catch { s = undefined; }
    if (typeof s !== 'string' || !s || s === key) { const l2 = String(this.lang).slice(0, 2), loc = LOCAL[l2], lc = LOCAL_CAR[l2]; s = (loc && loc[key]) ?? (lc && lc[key]) ?? (I18N[l2] && I18N[l2][key]) ?? fb ?? EN[key] ?? LOCAL.en[key] ?? key.split('.').pop(); }
    return s;
  }
  get dir() { const d = this.i18n && this.i18n.dir; const v = typeof d === 'function' ? d() : d; return v === 'rtl' ? 'rtl' : v === 'ltr' ? 'ltr' : (document.documentElement.dir || 'ltr'); }
  get lang() { const l = this.i18n && this.i18n.lang; return (typeof l === 'function' ? l() : l) || document.documentElement.lang || 'en'; }

  // ======================= init =======================
  async _init() {
    mark('init');
    this.mods = this.opts.modules ? await loadModules(this.opts.modules) : await preloadWalkModules();
    mark('modules');
    if (this.disposed) return;
    const M = this.mods;
    this.styles = (M.materials && Array.isArray(M.materials.STYLES) && M.materials.STYLES.length) ? M.materials.STYLES : FALLBACK_STYLES;
    if (!this.styles.some(s => s.id === this.styleId)) this.styleId = this.styles[0].id;

    // Interior image-based lighting (RoomEnvironment), swapped with the sky env on outdoor spots.
    try { this.roomEnv = this._spareEnv || roomEnvFor(this.renderer); } catch (e) { console.warn('[walk] RoomEnvironment failed', e); this.roomEnv = null; }
    this._spareEnv = null;

    // First-frame state = final state for the shaders: fog type + the full light set (ghosts stand in for the lights
    // of the environment, the commons rig and the car headlights until those stream in; see _streamWorld).
    this.scene.fog = FOG_PLACEHOLDER();
    this.scene.background = new THREE.Color(0x0b0d14);
    this._ghosts = makeGhosts(); for (const g of this._ghosts) this.scene.add(g);
    this._lightPool = [];
    for (let i = 0; i < LIGHT_SLOTS; i++) { const l = new THREE.PointLight(0xffe2b8, 0, 7.5, 1.6); l.name = 'walk-apt-light'; this.scene.add(l); this._lightPool.push(l); }
    this.skyEnv = null;
    // Building wrappers: commons groups (building-local) live inside these.
    this.bWrap = {};
    for (const [id, b] of Object.entries(BUILDINGS)) {
      const g = new THREE.Group(); g.name = 'walk-bldg-' + id; g.position.set(b.origin[0], 0, b.origin[1]); g.rotation.y = b.rotY;
      this.scene.add(g); this.bWrap[id] = g;
    }
    this._renderStyles(); this._renderTime();
  }

  // Sky, light, fog and neighbourhood (environment.js). Streamed in after the first apartment frame.
  _initEnv() {
    const M = this.mods;
    if (M.environment && M.environment.createEnvironment) {
      try {
        this.env = M.environment.createEnvironment(this.scene, this.renderer, { mode: this.envMode });
        if (this.env && this.env.group && !this.env.group.parent) this.scene.add(this.env.group);
      } catch (e) { console.warn('[walk] createEnvironment threw', e); this.env = null; }
    }
    if (!this.env) this._fallbackEnv();
    this.skyEnv = (this.scene.environment !== this.roomEnv && this.scene.environment) || this.skyEnv || null;
    this._syncEnvMap();
  }
  // The complex's facades (exterior.js). Streamed in after the environment.
  _initComplex() {
    const M = this.mods;
    if (M.exterior && M.exterior.createComplex) {
      try {
        this.complex = M.exterior.createComplex({});
        if (this.complex && this.complex.group && !this.complex.group.parent) this.scene.add(this.complex.group);
      } catch (e) { console.warn('[walk] createComplex threw', e); this.complex = null; }
    }
    this._hideFloorsForWalker(true);
  }
  // Swap ghost lights for the real ones that have arrived (keeps every light-type count constant).
  _reconcileGhosts() {
    const G = this._ghosts; if (!G || !G.length) return;
    const real = {};
    this.scene.traverseVisible(o => { if (o.isLight && !o.userData._ghost) real[o.type] = (real[o.type] || 0) + 1; });
    const have = {}; for (const g of G) have[g.userData._ghost] = (have[g.userData._ghost] || 0) + 1;
    for (const type of Object.keys(have)) {
      let extra = have[type] - Math.max(0, (LIGHT_TOTALS[type] || 0) - (real[type] || 0));
      for (let i = G.length - 1; i >= 0 && extra > 0; i--) if (G[i].userData._ghost === type) { this.scene.remove(G[i]); G.splice(i, 1); extra--; }
    }
  }
  // After the first frame: corridor & lifts → environment → exterior → cars, one per frame, so the view stays live.
  _streamWorld() {
    if (this._worldP) return this._worldP;
    const next = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    const steps = [
      async () => { if (!this.commons && this.unit) await this._setFloor(this.unit.building, this.floor != null ? this.floor : this.unit.floor); },
      () => this._initEnv(),
      () => this._initComplex(),
      () => { this._initOutdoor(); this._initCars(); if (this.commons) this._adoptParking(this.commons); },
    ];
    this._worldP = (async () => {
      await next(); await new Promise(r => setTimeout(r, 450));    // let the page's reveal (fade of the still) finish first
      for (const step of steps) {
        await next(); if (this.disposed) return;
        try { await step(); } catch (e) { console.warn('[walk] stream step failed', e); }
        mark('stream-' + steps.indexOf(step));
        if (this.disposed) return;
        this._reconcileGhosts();
      }
      this._worldReady = true; mark('world');
      // other designs' textures: generated off the main thread into IndexedDB only (no memory held), so a design
      // switch just decodes them (desktop: phones keep their CPU for the 3D)
      const Mm = this.mods.materials;
      if (!this._isTouch && Mm && Mm.prewarmTextures) for (const st of this.styles) if (st.id !== this.styleId) Mm.prewarmTextures(st.id, { cacheOnly: true });
    })();
    return this._worldP;
  }
  // Textures for the current design (from the worker / IndexedDB); no-op when already there or unsupported.
  async _texReady(styleId = this.styleId) {
    const Mm = this.mods && this.mods.materials;
    if (Mm && Mm.prewarmTextures) { try { await Mm.prewarmTextures(styleId); } catch { /* generate inline */ } }
  }
  // Compile what the camera needs and draw one frame before the veil lifts.
  async _firstFrame() {
    this._reconcileGhosts();
    this._syncCamera();
    // With KHR_parallel_shader_compile the programs link in the background (the still keeps animating); without it
    // a plain render compiles only what the camera sees, which is less work than compiling the whole apartment.
    let par = false; try { par = !!this.renderer.getContext().getExtension('KHR_parallel_shader_compile'); } catch { /* */ }
    try { if (par && this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera); } catch (e) { /* render compiles */ }
    mark('compiled');
    if (this.disposed) return;
    try { this.renderer.render(this.scene, this.camera); } catch (e) { console.warn(e); }
    await new Promise(r => requestAnimationFrame(() => r()));
  }

  _fallbackEnv() {
    const g = new THREE.Group(); g.name = 'walk-fallback-env';
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x404848, 1.1);
    const sun = new THREE.DirectionalLight(0xfff0dd, 1.5); sun.position.set(100, 200, 80);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x3d4a38, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
    g.add(hemi, sun, ground); this.scene.add(g); this._own.push(g);
    const skies = { day: 0x9cc4e8, dusk: 0x5a4c66, night: 0x0a0e1a };
    const setMode = m => { this.scene.background = new THREE.Color(skies[m] || skies.dusk); hemi.intensity = m === 'night' ? 0.25 : m === 'dusk' ? 0.7 : 1.2; sun.intensity = m === 'day' ? 2 : m === 'dusk' ? 0.6 : 0; };
    setMode(this.envMode);
    this.env = { group: g, sun, setMode, update() {}, dispose() {}, _fallback: true };
  }

  // ======================= public API =======================
  async enter({ unitId, start = 'apartment', mode = 'walk', from = null } = {}) {
    const token = (this._enterToken = (this._enterToken || 0) + 1);
    this._showLoading(true);
    await this._ready;
    if (this.disposed || token !== this._enterToken) return;
    const unit = unitById(unitId) || this.unit || UNITS.find(u => u.walk && u.building === DEFAULT_SEL.b && u.floor === DEFAULT_SEL.f) || UNITS.find(u => u.walk) || UNITS[0];
    if (!unit) throw new Error('[walk] no units in data.js');
    if (!['apartment', 'balcony', 'corridor', 'lobby', 'parking', 'entrance', 'outside'].includes(start)) start = 'apartment';
    if (unit !== this.unit || !this.apt) {
      this.unit = unit; this.bId = unit.building;
      this._hideUnitCard();
      await this._texReady(); mark('textures');
      if (this.disposed || token !== this._enterToken) return;
      await this._buildApartment(); mark('apartment');
      if (this.disposed || token !== this._enterToken) return;
    }
    this._updateTitle();
    this._renderRooms();
    this.mode = mode === '360' ? '360' : 'walk';
    // Streaming: inside the apartment the corridor/lifts are not needed for the first frame (they follow right after).
    const aptFirst = !this._worldP && !['lobby', 'corridor', 'parking', 'entrance', 'outside'].includes(start);
    const fromPano = from && from.frame !== 'building' && isFinite(from.u) && isFinite(from.v) && (!from.unitId || from.unitId === this.unit.id);
    if (fromPano) {   // coming from the photoreal 360°: open at the same spot, looking the same way
      if (aptFirst) { this.floor = this.unit.floor; this.bId = this.unit.building; }
      await this._placeFromPano(from);
      this._updateHud(true);
    } else await this._goto(start, { instant: true, skipFloor: aptFirst });
    if (this.disposed || token !== this._enterToken) return;
    this._applyMode();
    await this._firstFrame(); mark('first-frame');
    if (this.disposed || token !== this._enterToken) return;
    this._showLoading(false);
    this._streamWorld();
    this.canvas.focus({ preventScroll: true });
    if (!lsGet('vrc.walk.help')) this._showHelp(true);
    setTimeout(() => { if (!this.disposed) this._preloadPano(); }, 1200);
    if (lsGet('vrc.walk.view') === 'photo' && this.opts.pano !== false && lsGet('vrc.walk.help')) {
      Promise.resolve(window.VRC_PANO ? null : this._preloadPano()).then(() => {
        if (!this.disposed && token === this._enterToken && !this._pano && this._panoAvail()) this._openPano();
      });
    }
  }

  async setStyle(styleId) {
    if (!styleId || styleId === this.styleId && this.apt) { this._renderStyles(); return; }
    this.styleId = styleId;
    this._renderStyles();
    if (!this.unit) return;
    await this._ready;
    this._toast(this._styleName(styleId));
    await this._texReady(styleId);
    if (this.disposed || this.styleId !== styleId) return;
    await this._buildApartment();       // player state untouched → camera keeps its place
    this._renderRooms(); this._renderFinish();
    if (!this.finishId) this._reskinCommons();
    this._updateHud(true);
    if (this.mode === 'walk') this._depenetrate(4);
  }

  get finishList() {
    const L = this.mods && this.mods.commons && this.mods.commons.COMMON_FINISHES;
    return Array.isArray(L) && L.length ? L.map(f => f.id) : ['classic', 'grand', 'stone'];
  }
  _finish() {
    if (this.finishId && this.finishList.includes(this.finishId)) return this.finishId;
    const fn = this.mods && this.mods.commons && this.mods.commons.finishForStyle;
    const f = typeof fn === 'function' ? fn(this.styleId) : 'classic';
    return this.finishList.includes(f) ? f : 'classic';
  }
  /** Switch the building finish (lobbies, corridors, lifts, parking lobbies) and rebuild the current floor in place. */
  async setFinish(id) {
    if (!this.finishList.includes(id)) return;
    const before = this._finish();
    this.finishId = id; lsSet('vrc.walk.finish', id);
    this._renderFinish();
    if (id === before) return;
    this._toast(this.t('walk.finish.' + id));
    await this._reskinCommons();
  }
  async _reskinCommons() {
    const c = this.commons;
    // while riding / driving the next floor build picks the new finish up
    if (!c || this.riding || this.drive || this.disposed || c.finish === this._finish()) return;
    const tok = (this._reskinTok = (this._reskinTok || 0) + 1);
    const inCar = this._carOf(this.player.pos);
    let nc = null;
    try { nc = await this._buildCommons(c.bId, c.floor); } catch (e) { console.warn('[walk] finish rebuild', e); return; }
    if (this.disposed || tok !== this._reskinTok || this.commons !== c || this.riding || this.drive) { this._disposeCommons(nc); return; }
    if (this._cgOpen) this._cgClose();
    this._disposeCommons();
    this._activateCommons(nc);
    if (inCar) {
      const tw = this.liftInfos.find(i => i.bId === inCar.bId && i.core === inCar.core && i.doorIndex === inCar.doorIndex);
      if (tw) { tw.lift.car.visible = true; this._occupy(tw); try { tw.lift.open(); } catch (e) { console.warn(e); } }
    }
    this._hideFloorsForWalker(true);
    this._renderLiftPanel(); this._updateHud(true);
  }

  setTimeMode(mode) {
    this.envMode = mode;
    try { this.env && this.env.setMode(mode); } catch (e) { console.warn(e); }
    this.skyEnv = this.scene.environment !== this.roomEnv ? this.scene.environment : this.skyEnv;
    this._renderTime();
  }

  /** Capture the current view as a high-res PNG data URL → opts.onPhoto(dataUrl), else download it. */
  takePhoto(scale = 2.5) {
    if (this.disposed) return null;
    const r = this.renderer, prev = r.getPixelRatio();
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    // cap the long side at ~4096 px to stay within mobile GPU limits
    const pr = Math.max(prev, Math.min(scale, 4096 / Math.max(w, h)));
    let url = null;
    try {
      r.setPixelRatio(pr); r.setSize(w, h, false);
      r.render(this.scene, this.camera);
      url = this.canvas.toDataURL('image/png');   // same task as render → drawing buffer still valid
    } catch (e) { console.warn('[walk] photo failed', e); }
    finally { r.setPixelRatio(prev); r.setSize(w, h, false); r.render(this.scene, this.camera); }
    if (!url) return null;
    this.el.fade.style.transition = 'none'; this.el.fade.style.background = '#fff'; this.el.fade.style.opacity = '0.7';
    requestAnimationFrame(() => { this.el.fade.style.transition = ''; this.el.fade.style.opacity = '0'; setTimeout(() => { this.el.fade.style.background = ''; }, 320); });
    this._toast(this.t('walk.photoSaved'));
    if (typeof this.opts.onPhoto === 'function') { try { this.opts.onPhoto(url); } catch (e) { console.warn(e); } }
    else {
      const a = document.createElement('a'); a.href = url;
      a.download = `VILNYI-UZHHOROD-${this.unit ? this.unit.id : 'view'}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    }
    return url;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { if (this._cgSpoke && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* optional */ }
    cancelAnimationFrame(this._raf);
    if (this._pano) {
      const p = this._pano; this._pano = null;
      try { const h = p.handle; h && (h.close || h.dispose || h.destroy) && (h.close || h.dispose || h.destroy).call(h); } catch (e) { console.warn(e); }
      p.host.remove();
    }
    clearTimeout(this._soonT);
    this._unbind();
    const safe = f => { try { f(); } catch (e) { console.warn('[walk] dispose', e); } };
    safe(() => this._engineStop());
    safe(() => this.fleet && this.fleet.dispose());
    safe(() => this.outdoorPoles && this.outdoorPoles.dispose());
    safe(() => this.outdoor && this.outdoor.dispose());
    safe(() => this._disposeCommons());
    safe(() => this._disposeApartment());
    safe(() => this.complex && this.complex.dispose && this.complex.dispose());
    safe(() => this.env && this.env.dispose && this.env.dispose());
    safe(() => this.roomEnv && this.roomEnv.dispose());
    safe(() => { for (const o of this._own) disposeTree(o); this._own = []; });
    safe(() => disposeTree(this.scene));   // sweep anything left (textures of shared caches are re-uploaded if reused)
    safe(() => { this.scene.environment = null; this.scene.background = null; this.scene.clear(); });
    safe(() => { this.renderer.dispose(); this.renderer.forceContextLoss(); });
    this.root.remove();
    this.solids = this.floors = this.actions = [];
  }

  // ======================= building the world =======================
  // (Re)build the current unit (enter / design switch). Other loaded apartments are dropped; their corridor doors return.
  async _buildApartment() {
    const unit = this.unit;
    const prev = this.loaded.get(unit.id);
    const wasOpen = !!(prev && prev.apt.doorLeaf && prev.apt.doorLeaf.userData._open);
    const bdOpen = new Map();     // balcony doors that were open (a style change keeps them open): id → auto-opened?
    if (prev) for (const d of prev.apt.balconyDoors || []) if (d.open) bdOpen.set(d.id, this._bdS(d).auto);
    this._disposeApartment();
    const e = this._loadApt(unit);
    this._setCurrent(e, { quiet: true });
    if (wasOpen && e.apt.doorLeaf) this._toggleDoor(e.apt.doorLeaf, true);
    for (const d of e.apt.balconyDoors || []) if (bdOpen.has(d.id) && typeof d.toggle === 'function') {
      try { d.toggle(true, { instant: true }); this._bdS(d).auto = bdOpen.get(d.id); this._bdCurtains(e, d, true); } catch (err) { console.warn('[walk] balcony door', err); }
    }
  }

  // Build + place one apartment (sync, ~30–110 ms). Registered under its own collider source 'apt:<id>'.
  _loadApt(unit) {
    const M = this.mods;
    let apt = null;
    const t0 = performance.now();
    const pre = PREBUILT.get(unit.id + '|' + this.styleId);          // built (and its shaders compiled) during pre-warm
    if (pre) { PREBUILT.delete(unit.id + '|' + this.styleId); apt = pre; }
    else if (unit.walk !== false && M.apartment && M.apartment.buildApartment) {   // walk:false → no fitted 3D box: the fallback volume
      try { apt = M.apartment.buildApartment(unit, this.styleId, {}); } catch (e) { console.warn('[walk] buildApartment threw', e); }
    }
    if (!apt || !apt.group) apt = this._fallbackApartment(unit);
    this._polish(apt.group);
    const [wx, wz] = unitToWorld(unit, 0, 0), uY = floorY(unit.building, unit.floor), uH = floorH(unit.building, unit.floor);
    apt.group.position.set(wx, uY, wz);
    apt.group.rotation.y = unitYaw(unit) + BUILDINGS[unit.building].rotY;
    this.scene.add(apt.group);
    apt.group.updateMatrixWorld(true);
    // Lights: lift them out of the group into specs; the fixed light pool serves the apartment you're in.
    const specs = [];
    for (const l of apt.lights || []) {
      if (!l || !l.isLight) continue;
      if (!l.parent) apt.group.add(l);
      l.updateMatrixWorld(true);
      // Exposure balance: a point light 40 cm under the ceiling burns a white hotspot onto it. Hang it lower
      // (at ~1.75 m) and trim it so the floor keeps its level — the ceiling then reads as a soft, even wash.
      const pos = l.getWorldPosition(new THREE.Vector3());
      const hh = ((pos.y - uY) % uH + uH) % uH;
      const drop = hh > 1.9 ? Math.min(0.55, hh - 1.75) : 0;
      pos.y -= drop;
      specs.push({ pos, color: l.color.clone(), intensity: l.intensity * (drop ? 0.74 : 1), distance: l.distance, decay: l.decay });
      l.parent.remove(l);
    }
    if (!apt.doorLeaf) apt.group.traverse(o => { if (!apt.doorLeaf && o.userData && o.userData.action && o.userData.action.type === 'aptDoor') apt.doorLeaf = o; });
    const e = { unit, apt, src: 'apt:' + unit.id, lights: specs, rooms: null, ms: performance.now() - t0, fallback: !!apt._fallback };
    this.loaded.set(unit.id, e);
    this._register(apt.group, e.src);
    this._addMonitor(e);
    if (this.commons) this._hideDuplicateDoor();
    return e;
  }

  // Make a loaded apartment the "current" one: HUD title, rooms, minimap, Reserve and the light pool follow it.
  _setCurrent(e, { quiet = false } = {}) {
    if (!e) return;
    const changed = this.unit !== e.unit || this.apt !== e.apt;
    this.unit = e.unit; this.apt = e.apt; this.aptGroup = e.apt.group;
    if (!e.rooms) e.rooms = this._normalizeRooms(e.apt.rooms || []);
    this.rooms = e.rooms;
    this._assignLights(e);
    this._updateTitle(); this._renderRooms();
    this._lastPlace = null; this._lastMap = 0;
    if (this.el && this.floor != null) this._updateHud(true);
    this._hideFloorsForWalker(true);
    if (!quiet && changed) this._showUnitCard(e.unit);
  }

  _assignLights(e) {
    const pool = this._lightPool; if (!pool) return;
    const token = (this._lightTok = (this._lightTok || 0) + 1);
    const from = pool.map(l => l.intensity);
    const apply = () => pool.forEach((l, i) => {
      const s = e.lights[i];
      if (s) { l.position.copy(s.pos); l.color.copy(s.color); l.distance = s.distance; l.decay = s.decay; l.userData.to = s.intensity; } else l.userData.to = 0;
      l.intensity = 0;
    });
    if (from.every(v => v === 0)) { apply(); pool.forEach(l => { l.intensity = l.userData.to; }); return; }
    // quick cross-fade: out, move, in
    tween(160, k => { if (token === this._lightTok) pool.forEach((l, i) => { l.intensity = from[i] * (1 - k); }); })
      .then(() => { if (token !== this._lightTok) return; apply(); return tween(420, k => { if (token === this._lightTok) pool.forEach(l => { l.intensity = l.userData.to * k; }); }); });
  }

  _disposeEntry(e) {
    if (!e) return;
    this._unregister(e.src);
    if (e.monitor) { e.monitor.dispose(); e.monitor = null; }
    this.scene.remove(e.apt.group);
    try { e.apt.dispose ? e.apt.dispose() : disposeTree(e.apt.group); } catch (err) { console.warn(err); }
    this.loaded.delete(e.unit.id);
    if (this.apt === e.apt) { this.apt = null; this.aptGroup = null; }
  }

  // Keep at most MAX_APTS apartments: drop the farthest (never the current one or `keep`).
  _evict(keep) {
    while (this.loaded.size > MAX_APTS) {
      let worst = null, wd = -1;
      const P = this.player.pos;
      for (const e of this.loaded.values()) {
        if (e === keep || e.apt === this.apt) continue;
        const [x, z] = unitToWorld(e.unit, e.unit.width / 2, e.unit.depth / 2);
        const d = Math.hypot(P.x - x, (P.y - floorY(e.unit.building, e.unit.floor)) * 2, P.z - z);
        if (d > wd) { wd = d; worst = e; }
      }
      if (!worst) break;
      this._disposeEntry(worst);
    }
    if (this.commons) this._hideDuplicateDoor();
  }

  // Which loaded apartment contains the walker (same floor, inside its footprint incl. balcony)?
  _aptAt(pos) {
    for (const e of this.loaded.values()) {
      const u = e.unit;
      if (u.building !== this.bId) continue;
      const dy = pos.y - floorY(u.building, u.floor);
      if (dy < -0.6 || dy > 1.6) continue;
      const [lx, lz] = worldToLocal(u.building, pos.x, pos.z);
      const [uu, vv] = localToUnit(u, lx, lz);
      const B = this._aptBox(e);
      if (uu > B.u0 + 0.02 && uu < B.u1 - 0.02 && vv > 0.12 && vv < B.v1 + 0.3) return e;
    }
    return null;
  }

  // The extent of a loaded apartment in its own frame {u0, u1, v0, v1}: the fitted box, widened by its outdoor room
  // when it has one — beyond the far wall (v > depth) or, for a flat whose facade is lateral, beside it (u < 0 or
  // u > width). No outdoor room → the box only, so the strip outside a flat without a balcony is never taken for it.
  _aptBox(e) {
    if (!e.box) {
      const u = e.unit, m = GEOM.balconyDepth * 2, B = { u0: 0, u1: u.width, v0: 0, v1: u.depth };
      const grow = (a, b, pad = 0) => { if (!isFinite(a) || !isFinite(b)) return; B.u0 = Math.min(B.u0, a - pad); B.u1 = Math.max(B.u1, a + pad); B.v1 = Math.max(B.v1, b + pad); };
      for (const r of e.apt.rooms || []) if (OUTDOOR.has(r.kind)) { if (r.poly && r.poly.length) for (const p of r.poly) grow(p[0], p[1]); else grow(u.width / 2, u.depth + GEOM.balconyDepth); }
      const bp = e.apt.balconyPoint; if (bp) grow(bp.u, bp.v, GEOM.balconyDepth * 0.5);
      B.u0 = Math.max(B.u0, -m); B.u1 = Math.min(B.u1, u.width + m); B.v1 = Math.min(B.v1, u.depth + m);
      e.box = B;
    }
    return e.box;
  }

  _normalizeRooms(rooms) {
    const counts = {}, seen = {};
    rooms.forEach(r => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
    return rooms.map(r => {
      const poly = r.poly && r.poly.length >= 3 ? r.poly : null;
      const center = r.center || (poly ? polyCentroid(poly) : [this.unit.width / 2, this.unit.depth / 2]);
      const level = r.level || 0;
      const y = typeof r.y === 'number' ? r.y : 0;
      seen[r.kind] = (seen[r.kind] || 0) + 1;
      let label = this.t('walk.room.' + r.kind, EN['walk.room.' + r.kind] || r.name || r.kind);
      if (counts[r.kind] > 1 && r.kind !== 'hall') label += ' ' + seen[r.kind];
      return { ...r, poly, center, level, y, label };
    });
  }

  // Texture polish for a freshly built subtree: anisotropic filtering + mipmaps on every image map (shared textures once).
  _polish(root) {
    const A = this._aniso || 1; if (A <= 1 || !root) return;
    const KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'emissiveMap', 'clearcoatNormalMap'];
    root.traverse(o => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const k of KEYS) {
        const t = m[k];
        if (!t || !t.isTexture || t.isDataTexture && !t.generateMipmaps || t.anisotropy >= A || t.userData._aniso) continue;
        t.userData._aniso = true; t.anisotropy = A;
        if (t.version > 0 && this.renderer.properties.get(t).__webglTexture) t.needsUpdate = true;   // already on the GPU → re-apply
      }
    });
  }

  // Minimal closed, walkable volume. Used when apartment.js is missing or threw, and for every unit with walk:false
  // (no 3 × 4.5 m box fits the real flat; data.js then gives the clipped bounding box). Floor, ceiling, four plain
  // walls with a door opening at door.u on the entrance wall, one lamp. No outdoor room (balconyPoint: null).
  _fallbackApartment(unit) {
    const T = TYPES[unit.type] || {};
    const W = Math.max(1.3, unit.width || 3), D = Math.max(1.3, unit.depth || 4.5), t = 0.08, DW = 0.5, DH = 2.15;
    const H = Math.max(2.3, Math.min(LEVELS.ceiling, floorH(unit.building, unit.floor) - LEVELS.slab));
    const du = Math.max(DW + 0.05, Math.min(W - DW - 0.05, unit.door && isFinite(unit.door.u) ? unit.door.u : W / 2));
    const g = new THREE.Group(); g.name = 'walk-fallback-apt';
    const mFloor = new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.6 });
    const mWall = new THREE.MeshStandardMaterial({ color: 0xe6dfd0, roughness: 0.92 });
    const box = (w, h, d, x, y, z, m, flag) => { if (w < 0.02 || d < 0.02) return; const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); if (flag) o.userData[flag] = true; g.add(o); };
    box(W, 0.1, D, W / 2, -0.05, D / 2, mFloor, 'floor');
    box(W, 0.06, D, W / 2, H + 0.03, D / 2, mWall, null);
    box(W, H, t, W / 2, H / 2, D - t / 2, mWall, 'solid');                                   // far wall
    box(t, H, D, t / 2, H / 2, D / 2, mWall, 'solid'); box(t, H, D, W - t / 2, H / 2, D / 2, mWall, 'solid');   // party walls
    box(du - DW, H, t, (du - DW) / 2, H / 2, t / 2, mWall, 'solid');                         // entrance wall, both sides of the door
    box(W - du - DW, H, t, (W + du + DW) / 2, H / 2, t / 2, mWall, 'solid');
    box(DW * 2, H - DH, t, du, (H + DH) / 2, t / 2, mWall, null);                             // lintel
    const l = new THREE.PointLight(0xffe2b8, 14, 9, 1.6); l.position.set(W / 2, H - 0.45, D / 2);
    const rooms = [{ kind: 'living', name: 'living', area: T.util || T.total || +(W * D).toFixed(1), center: [W / 2, D / 2], poly: [[0, 0], [W, 0], [W, D], [0, D]] }];
    return { group: g, rooms, entrance: { u: du, v: 0 }, balconyPoint: null, doorLeaf: null, balconyDoors: [], lights: [l], _fallback: true, dispose() { disposeTree(g); } };
  }

  _disposeApartment() {
    for (const e of [...this.loaded.values()]) this._disposeEntry(e);
    this.apt = null; this.aptGroup = null;
    if (this.commons) this._hideDuplicateDoor();
  }

  async _buildCommons(bId, floor) {
    const M = this.mods;
    let c = null;
    if (M.commons && M.commons.buildFloorCommons) {
      try { c = await M.commons.buildFloorCommons(bId, floor, this._finish()); } catch (e) { console.warn('[walk] buildFloorCommons threw', e); }
    }
    if (!c || !c.group) {
      c = this._fallbackCommons(bId, floor);
      if (floor === -1 && (this._parkFail = (this._parkFail || 0) + 1) === 2 && this.el) this._renderTeleports();   // the Parking chip goes
    }
    c.bId = bId; c.floor = floor;
    this._polish(c.group);
    const wrap = this.bWrap[bId];
    wrap.add(c.group);
    c.lifts = Array.isArray(c.lifts) ? c.lifts : [];
    for (const L of c.lifts) if (L && L.group && !L.group.parent) wrap.add(L.group);
    // Helper walkable pads inside each lift car (in case the car floor isn't flagged userData.floor).
    c._helpers = new THREE.Group(); c._helpers.name = 'walk-lift-pads'; wrap.add(c._helpers);
    c._infos = c.lifts.map((L, i) => { try { return this._liftInfo(L, i, bId, floor); } catch (e) { console.warn('[walk] lift ignored', e); return null; } }).filter(Boolean);
    const padGeo = new THREE.BoxGeometry(1.7, 0.02, CAR_DEPTH * 2 + 0.2);
    const padMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const inf of c._infos) {
      const pad = new THREE.Mesh(padGeo, padMat);
      const [pwx, pwz] = localToWorldXZ(inf.bId, inf.car[0] + inf.n[0] * 0.1, inf.car[1] + inf.n[1] * 0.1), [plx, plz] = worldToLocal(bId, pwx, pwz);
      const [dnx, dnz] = dirToWorld(inf.bId, inf.n[0], inf.n[1]);
      pad.position.set(plx, floorY(bId, floor) - 0.01, plz);
      pad.rotation.y = Math.atan2(dnx, dnz) - BUILDINGS[bId].rotY;
      pad.userData.floor = true; pad.userData._helper = true; c._helpers.add(pad);
    }
    c._padGeo = padGeo; c._padMat = padMat;
    wrap.updateMatrixWorld(true);
    return c;
  }

  // Plain hall when commons.js is missing or threw for this floor: the hall rects (or the whole car park at −1) as a
  // floor, plain walls on the hall boundary with openings at the flat doors and the ground entrance, no lifts.
  _fallbackCommons(bId, floor) {
    const g = new THREE.Group(); g.name = 'walk-fallback-commons';
    const m = new THREE.MeshStandardMaterial({ color: 0x6b645a, roughness: 0.7 }), wm = new THREE.MeshStandardMaterial({ color: 0xd8d1c2, roughness: 0.9 });
    const y = floorY(bId, floor), H = 2.6, park = floor === -1, core = coresOf(bId, park ? 1 : floor)[0] || null;
    // the car park is one slab under the whole site: its world bbox seen in this building's frame
    const rects = park ? [bboxOf([[PARKING.x0, PARKING.z0], [PARKING.x1, PARKING.z0], [PARKING.x1, PARKING.z1], [PARKING.x0, PARKING.z1]].map(([x, z]) => worldToLocal(bId, x, z)))] : corridorsOf(bId, floor);
    for (const r of rects) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, 0.1, r.z1 - r.z0), m);
      f.position.set((r.x0 + r.x1) / 2, y - 0.05, (r.z0 + r.z1) / 2); f.userData.floor = true; g.add(f);
    }
    const edges = park ? [{ axis: 'x', c: rects[0].z0, a0: rects[0].x0, a1: rects[0].x1, side: 1 }, { axis: 'x', c: rects[0].z1, a0: rects[0].x0, a1: rects[0].x1, side: -1 },
      { axis: 'z', c: rects[0].x0, a0: rects[0].z0, a1: rects[0].z1, side: 1 }, { axis: 'z', c: rects[0].x1, a0: rects[0].z0, a1: rects[0].z1, side: -1 }] : hallEdgesOf(bId, floor);
    const units = park ? [] : unitsOn(bId, floor);
    for (const e of edges) {
      const gaps = [];
      for (const u of units) if (u.run && u.run.axis === e.axis && Math.abs(u.run.c - e.c) < 0.03 && u.run.side === e.side && u.doorA > e.a0 - 0.01 && u.doorA < e.a1 + 0.01) gaps.push([u.doorA - 0.5, u.doorA + 0.5]);
      if (!park && isGround(floor) && core && core.entrance) {
        const a = e.axis === 'x' ? core.entrance[0] : core.entrance[1], cc = e.axis === 'x' ? core.entrance[1] : core.entrance[0];
        if (Math.abs(cc - e.c) < 0.06 && a > e.a0 - 0.01 && a < e.a1 + 0.01) gaps.push([a - 1.0, a + 1.0]);
      }
      gaps.sort((p, q) => p[0] - q[0]);
      let cur = e.a0;
      const seg = (a0, a1) => {
        if (a1 - a0 < 0.03) return;
        const w = new THREE.Mesh(e.axis === 'x' ? new THREE.BoxGeometry(a1 - a0, H, 0.1) : new THREE.BoxGeometry(0.1, H, a1 - a0), wm);
        const mid = (a0 + a1) / 2, off = e.c - e.side * 0.05;
        w.position.set(e.axis === 'x' ? mid : off, y + H / 2, e.axis === 'x' ? off : mid); w.userData.solid = true; g.add(w);
      };
      for (const [g0, g1] of gaps) { seg(cur, Math.min(g0, e.a1)); cur = Math.max(cur, g1); }
      seg(cur, e.a1);
    }
    g.add(new THREE.HemisphereLight(0xfff0dd, 0x333333, 0.8));
    return { group: g, lifts: [], doors: [], spawn: this._hallSpawn(bId, floor), bId, floor, _fallback: true, dispose() { disposeTree(g); } };
  }
  // A standing point of a floor when the commons give none: the centre of the largest hall rect; in the car park,
  // 2.5 m in front of the tower's first lift door (the floor-1 core projected down).
  _hallSpawn(bId, floor) {
    const core = coresOf(bId, floor === -1 ? 1 : floor)[0];
    if (floor === -1 && core && core.liftDoors[0]) { const d = core.liftDoors[0], n = (core.liftNormals && core.liftNormals[0]) || [0, 1]; return { x: d[0] + n[0] * 2.5, z: d[1] + n[1] * 2.5, yaw: Math.atan2(n[0], n[1]) + Math.PI }; }
    let best = null;
    for (const r of corridorsOf(bId, floor)) if (!best || (r.x1 - r.x0) * (r.z1 - r.z0) > (best.x1 - best.x0) * (best.z1 - best.z0)) best = r;
    if (best) return { x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2, yaw: best.x1 - best.x0 > best.z1 - best.z0 ? Math.PI / 2 : 0 };
    const fp = bboxOf(footprintOf(bId, floor === -1 ? 1 : floor)); return { x: (fp.x0 + fp.x1) / 2, z: (fp.z0 + fp.z1) / 2, yaw: 0 };
  }

  // One record per lift of the loaded floor. One core per tower (index 0); each lift has its own door and normal.
  _liftInfo(lift, i, bId, floor) {
    if (lift && BUILDINGS[lift.bId]) bId = lift.bId;   // the car park also holds the other towers' lifts
    const core = coresOf(bId, floor === -1 ? 1 : floor)[0], nd = Math.max(1, core.liftDoors.length);
    const di = typeof lift.doorIndex === 'number' && core.liftDoors[lift.doorIndex] ? lift.doorIndex : i % nd;
    const door = core.liftDoors[di], n = (core.liftNormals && core.liftNormals[di]) || core.liftNormal;
    const cd = lift.carDepth > 0 ? lift.carDepth : CAR_DEPTH;
    return { lift, core: 0, doorIndex: di, stair: core.stair, bId, floor, door, n, carDepth: cd, car: [door[0] - n[0] * cd, door[1] - n[1] * cd] };
  }

  // Commons builds a closed corridor leaf at every unit door; for each LOADED apartment hide it (apartment.js supplies the operable one).
  _hideDuplicateDoor() {
    for (const o of this._hiddenDoors || []) { o.visible = true; o.userData.solid = o.userData._solid; o.userData.action = o.userData._action; }
    this._hiddenDoors = [];
    const c = this.commons; if (!c) return;
    const ids = new Set(this.loaded.keys());
    if (ids.size) c.group.traverse(o => {
      const ud = o.userData || {}, a = ud.action;
      if ((a && a.type === 'aptDoor' && ids.has(a.unitId)) || (ud.doorLeaf && ids.has(ud.unitId))) {
        ud._solid = ud.solid; ud._action = a; ud.solid = false; delete ud.action; o.visible = false; this._hiddenDoors.push(o);
      }
    });
    this._unregister('commons'); this._registerCommons(c);
  }
  _registerCommons(c) {
    this._register(c.group, 'commons', false, new Set(c.lifts.map(L => L.group)));
    for (const L of c.lifts) if (L.group) this._register(L.group, 'commons', true);
    this._register(c._helpers, 'commons');
  }

  _activateCommons(c) {
    this.commons = c;
    this.liftInfos = c._infos || [];
    this._hiddenDoors = [];
    this._hideDuplicateDoor();   // also registers the commons colliders/actions
    this._adoptParking(c);
  }

  _disposeCommons(c = this.commons) {
    if (!c) return;
    if (c === this.commons) { this._unregister('commons'); this.commons = null; this.liftInfos = []; }
    try { c.dispose && c.dispose(); } catch (e) { console.warn(e); }
    for (const L of c.lifts || []) { if (L.group && L.group.parent) L.group.parent.remove(L.group); try { L.dispose && L.dispose(); } catch { /* optional */ } }
    if (c.group.parent) c.group.parent.remove(c.group);
    if (c._helpers) { c._helpers.parent && c._helpers.parent.remove(c._helpers); c._padGeo.dispose(); c._padMat.dispose(); }
  }

  async _setFloor(bId, floor) {
    if (this.commons && this.commons.bId === bId && this.commons.floor === floor) return;
    const c = await this._buildCommons(bId, floor);
    if (this.disposed) return;
    this._disposeCommons();
    this._activateCommons(c);
    this.floor = floor; this.bId = bId;
    this._hideFloorsForWalker(true);
    this._renderLiftPanel();
  }

  // Which facade floor bands to hide so the exterior never covers the interior we are in.
  _hideFloorsForWalker(force) {
    if (!this.complex || !this.complex.setHiddenFloor || this.floor == null) return;
    // outdoors and in the car park every facade is shown; on floor ≥ 1 the band of that floor of that tower is hidden
    const out = this.floor < 1 || this._isOutside(this.player.pos);
    const key = out ? 'out' : this.bId + ':' + this.floor;
    if (!force && key === this._hiddenKey) return;
    this._hiddenKey = key;
    try { for (const id of B_IDS) this.complex.setHiddenFloor(id, !out && id === this.bId ? this.floor : null); } catch (e) { console.warn('[walk] setHiddenFloor', e); }
  }

  // ======================= collider registry =======================
  _register(root, src, dyn = false, skip = null) {
    root.updateMatrixWorld(true);
    const walk = (o, act, solid, floor, d) => {
      if (skip && skip.has(o) && o !== root) return;
      const ud = o.userData || {};
      const a = ud.action ? o : act;
      const s = solid || !!ud.solid, f = floor || !!ud.floor, dd = d || !!ud.dynamic;
      if (o.isMesh) {
        // Toggleable blockers (balcony / sliding doors: userData.solid flips false while open) stay registered whatever
        // their state at build time; _near() skips them while solid === false and re-reads their box every frame.
        const tog = ud.solid === false || typeof ud.toggle === 'function';
        if ((s || ud.solid === false) && !f) this.solids.push({ o, src, dyn: dd || !!a || tog, box: null });
        if (f) { this.floors.push({ o, src, dyn: dd, box: null }); if (!ud._helper) this.floorReq = true; }
        if (a) this.actions.push({ o, root: a, src });
      }
      for (const c of o.children) walk(c, a, s && !o.isMesh, f && !o.isMesh, dd);
    };
    walk(root, null, false, false, dyn);
  }
  _unregister(src) {
    this.solids = this.solids.filter(e => e.src !== src);
    this.floors = this.floors.filter(e => e.src !== src);
    this.actions = this.actions.filter(e => e.src !== src);
    this.floorReq = this.floors.some(e => !e.o.userData._helper);
  }
  _near(list, p, r) {
    const out = [];
    for (const e of list) {
      if (!e.o.parent || e.o.userData.solid === false) continue;
      if (e.dyn || !e.box) { e.box = e.box || new THREE.Box3(); e.box.setFromObject(e.o); }
      if (e.box.distanceToPoint(p) < r) out.push(e.o);
    }
    return out;
  }
  // Solids around a walker. The street-level building shell (cars.js outline walls, 0–4 m high, just inside the facade
  // line) is for people and cars outside: inside an apartment it would wall up the balcony doors and swallow taps on
  // them, on floor 2 its top 0.4 m would stand in the hall, and on a car-park ramp that runs through a tower it would
  // close the portal — so it is left out there (the interior's own walls, railings and ramp walls do the job).
  _solidsNear(p, r, feet = p) {
    const out = this._near(this.solids, p, r);
    return this.outdoor && this._noShell(feet) ? out.filter(o => o.name !== 'outdoor-solid') : out;
  }
  _noShell(p) { return p.y > 2.5 || this._rampDist(p.x, p.z) < 0.3 || !!this._aptAt(p); }
  // Raycast treating every material as double-sided (walls may be thin planes seen from behind).
  _cast(objects, origin, dir, far) {
    if (!objects.length) return [];
    const ray = this._ray; ray.set(origin, dir); ray.near = 0; ray.far = far;
    const touched = [];
    for (const o of objects) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (m && m.side !== THREE.DoubleSide) { touched.push(m, m.side); m.side = THREE.DoubleSide; }
    }
    let hits;
    try { hits = ray.intersectObjects(objects, false); } finally { for (let i = touched.length - 2; i >= 0; i -= 2) touched[i].side = touched[i + 1]; }
    return hits;
  }

  // ======================= movement & collisions =======================
  _floorAt(x, y, z, entries) {
    const o = this._v1.set(x, y + STEP_UP, z);
    const hits = this._cast(entries, o, this._v2.set(0, -1, 0), STEP_UP + STEP_DOWN);
    return hits.length ? hits[0].point.y : null;
  }

  _hitNormal(h, fallbackDir) {
    if (!h.face) return fallbackDir.clone().negate();
    const n = h.face.normal.clone();
    if (h.object.isInstancedMesh && h.instanceId != null) { const m = new THREE.Matrix4(); h.object.getMatrixAt(h.instanceId, m); n.transformDirection(m); }
    n.transformDirection(h.object.matrixWorld); n.y = 0;
    if (n.lengthSq() < 1e-6) return fallbackDir.clone().negate();
    n.normalize();
    if (n.dot(fallbackDir) > 0) n.negate();
    return n;
  }

  // Sweep the player horizontally by `delta` with slide; returns actual movement length.
  _move(delta) {
    const P = this.player.pos, len0 = Math.hypot(delta.x, delta.z);
    if (len0 < 1e-6) return 0;
    const solids = this._solidsNear(P, len0 + 1.2);
    const floors = this._near(this.floors, P, len0 + 1.5);
    let moved = 0, d = new THREE.Vector3(delta.x, 0, delta.z);
    for (let iter = 0; iter < 2 && d.lengthSq() > 1e-8; iter++) {
      const len = d.length(), dir = d.clone().divideScalar(len);
      let allow = len, n = null;
      for (const h of RAY_HEIGHTS) {
        const hits = this._cast(solids, this._v1.set(P.x, P.y + h, P.z), dir, len + RADIUS);
        const hit = hits.find(x => !x.object.userData.floor);
        if (hit && hit.distance - RADIUS < allow) { allow = Math.max(0, hit.distance - RADIUS - 0.005); n = this._hitNormal(hit, dir); }
      }
      if (allow > 1e-5) {
        const nx = P.x + dir.x * allow, nz = P.z + dir.z * allow;
        const fy = this._floorAt(nx, P.y, nz, floors);
        if (fy === null && this.floorReq) { n = n || dir.clone().negate(); allow = 0; }
        else { P.x = nx; P.z = nz; if (fy !== null) this._targetY = fy; moved += allow; }
      }
      if (!n || allow >= len - 1e-5) break;
      const rem = d.clone().multiplyScalar(1 - allow / len);
      d = rem.sub(n.clone().multiplyScalar(rem.dot(n)));   // slide along the wall
    }
    this._depenetrate(1, solids);
    return moved;
  }

  _depenetrate(iters = 1, solids = null) {
    const P = this.player.pos;
    solids = solids || this._solidsNear(P, 1.2);
    if (!solids.length) return;
    const dir = this._v2;
    for (let k = 0; k < iters; k++) {
      let px = 0, pz = 0;
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2; dir.set(Math.cos(a), 0, Math.sin(a));
        for (const h of [0.3, 1.0]) {
          const hit = this._cast(solids, this._v1.set(P.x, P.y + h, P.z), dir, RADIUS).find(x => !x.object.userData.floor);
          if (hit) { const push = RADIUS - hit.distance; px -= dir.x * push / 2; pz -= dir.z * push / 2; }
        }
      }
      if (Math.abs(px) + Math.abs(pz) < 1e-4) break;
      const fy = this._floorAt(P.x + px, P.y, P.z + pz, this._near(this.floors, P, 1.5));
      if (fy === null && this.floorReq) break;
      P.x += px; P.z += pz;
    }
  }

  _isFree(x, y, z) {
    const p = new THREE.Vector3(x, y, z);
    const solids = this._solidsNear(p, 1.0), floors = this._near(this.floors, p, 1.5);
    if (this.floorReq && this._floorAt(x, y, z, floors) === null) return false;
    const down = this._cast(solids, new THREE.Vector3(x, y + 1.9, z), new THREE.Vector3(0, -1, 0), 1.85);
    if (down.some(h => !h.object.userData.floor)) return false;
    const dir = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2; dir.set(Math.cos(a), 0, Math.sin(a));
      for (const h of [0.3, 1.0]) if (this._cast(solids, new THREE.Vector3(x, y + h, z), dir, RADIUS + 0.08).some(q => !q.object.userData.floor)) return false;
    }
    return true;
  }
  // Nearest free standing spot around (x,z) — spiral search.
  _freeSpot(x, y, z, maxR = 1.6) {
    if (this._isFree(x, y, z)) return [x, z];
    for (let r = 0.35; r <= maxR; r += 0.35) {
      const n = Math.max(6, Math.round(r * 14));
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (this._isFree(px, y, pz)) return [px, pz]; }
    }
    return [x, z];
  }

  // ======================= placing the camera =======================
  _unitPoint(u, v, level = 0) {
    const [x, z] = unitToWorld(this.unit, u, v);
    return new THREE.Vector3(x, floorY(this.unit.building, this.unit.floor), z);
  }
  _unitDirYaw(du, dv) {
    const U = this.unit.frame.U, V = this.unit.frame.V;
    const [wx, wz] = dirToWorld(this.unit.building, U[0] * du + V[0] * dv, U[1] * du + V[1] * dv);
    return yawFromDir(wx, wz);
  }
  _place(pos, yaw, pitch = -0.04) {
    const P = this.player;
    P.pos.copy(pos); this._targetY = pos.y; P.vel.set(0, 0, 0);
    P.yaw = P.tYaw = yaw; P.pitch = P.tPitch = pitch;
    this.glide = null; this.touched360 = false;
    this._syncCamera();
    this._hideFloorsForWalker(true);
  }

  // Resolve a start/teleport target to {floor, pos, yaw}
  _spot(where) {
    const u = this.unit, apt = this.apt;
    const unitFloor = u.floor;
    // no outdoor room (or the fallback volume): 'balcony' degrades to 'apartment'
    if (where === 'balcony' && !(apt && apt.balconyPoint) && !(this.rooms || []).some(r => OUTDOOR.has(r.kind))) where = 'apartment';
    if (where === 'lobby' || where === 'parking') return { floor: where === 'lobby' ? 1 : -1, spawn: true };
    if (where === 'corridor' || (where && where.door)) return this._doorSpot((where && where.door) || u);
    if (where === 'entrance' || where === 'outside') return { floor: 1, bId: u.building, outdoor: where };   // resolved by _outdoorSpot once the lobby is loaded
    if (where === 'balcony') {
      const out = this.rooms.find(r => OUTDOOR.has(r.kind));
      const bp = (apt && apt.balconyPoint) || { u: out.center[0], v: out.center[1] };
      // look out over the railing: along +v, or sideways when the outdoor room is on a lateral facade
      const du = bp.u < 0 ? -1 : bp.u > u.width ? 1 : 0;
      return { floor: unitFloor, pos: this._unitPoint(bp.u, bp.v), yaw: this._unitDirYaw(du, du ? 0 : 1), outRoom: out, free: true };
    }
    if (where && where.room) return this._roomSpot(where.room);
    // apartment: stand at the entrance side of the living room, looking into the flat
    const liv = this.rooms.find(r => r.kind === 'living') || this.rooms.find(r => !OUTDOOR.has(r.kind)) || null;
    if (liv) {
      const vs = liv.poly ? liv.poly.map(p => p[1]) : [liv.center[1] - 1.5];
      const v = Math.min(Math.min(...vs) + 0.9, liv.center[1]);
      // toward the windows: the far wall, or a side wall for the flats whose only facade is lateral
      const sf = u.frontFacade === false && u.sideFacades ? (u.sideFacades.right ? 1 : u.sideFacades.left ? -1 : 0) : 0;
      return { floor: unitFloor, pos: this._unitPoint(liv.center[0], v), yaw: this._unitDirYaw(sf || 0.18, sf ? 0.55 : 1), free: true };
    }
    const e = (apt && apt.entrance) || { u: u.door.u, v: 0 };
    return { floor: unitFloor, pos: this._unitPoint(e.u, 1.0), yaw: this._unitDirYaw(0, 1), free: true };
  }
  // In the hall, a little to the side of a flat's entrance door, looking at it diagonally. The halls of a point tower
  // are short and cranked, so the spot is searched: first choice 1.9 m beside the door, then closer, always inside a
  // hall rect of that floor.
  _doorSpot(d) {
    const halls = corridorsOf(d.building, d.floor);
    const inHall = (x, z, m = 0.32) => halls.some(r => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m);
    const pref = d.door.u > 1.9 ? -1 : 1;
    let best = null;
    search: for (const back of [0.85, 1.2, 0.6]) for (const side of [1.9, 1.3, 0.8, 0]) for (const sg of [pref, -pref]) {
      const [x, z] = unitToLocal(d, d.door.u + sg * side, -back);
      if (inHall(x, z)) { best = [x, z]; break search; }
    }
    if (!best) best = unitToLocal(d, d.door.u, -0.8);
    const [tx, tz] = unitToLocal(d, d.door.u, 0.35);
    const [wx, wz] = localToWorldXZ(d.building, best[0], best[1]), [dx, dz] = dirToWorld(d.building, tx - best[0], tz - best[1]);
    return { floor: d.floor, bId: d.building, pos: new THREE.Vector3(wx, floorY(d.building, d.floor), wz), yaw: yawFromDir(dx, dz), free: true };
  }
  // Outside the tower. 'entrance': on the forecourt in front of the lobby doors, facing the video intercom beside them
  // (the commons' own record when the lobby is loaded, else the contract position). 'outside': in the courtyard, a few
  // steps from the entrance toward the centre of the site, looking across the yard.
  _outdoorSpot(bId, kind) {
    const c = coresOf(bId, 1)[0];
    if (!c || !c.entrance || !c.entranceNormal) return null;
    const [ex, ez] = c.entrance, [nx, nz] = c.entranceNormal, y = floorY(bId, 1);
    if (kind === 'outside') {
      const [wx, wz] = localToWorldXZ(bId, ex + nx * 3, ez + nz * 3), dx = SITE_CENTER[0] - wx, dz = SITE_CENTER[1] - wz, L = Math.hypot(dx, dz) || 1, k = Math.min(7, L * 0.45);
      return { floor: 1, bId, pos: new THREE.Vector3(wx + dx / L * k, y, wz + dz / L * k), yaw: yawFromDir(dx, dz), pitch: 0.02, free: true };
    }
    let tx = -nz, tz = nx, ix, iz;
    const ic = this.commons && this.commons.bId === bId && (this.commons.intercoms || [])[0];
    if (ic && isFinite(ic.x) && isFinite(ic.z)) { ix = ic.x; iz = ic.z; if ((ix - ex) * tx + (iz - ez) * tz < 0) { tx = -tx; tz = -tz; } }
    else { ix = ex + nx * 0.1 + tx * INTERCOM_DX; iz = ez + nz * 0.1 + tz * INTERCOM_DX; }
    const [x, z] = localToWorldXZ(bId, ex + nx * 1.4 + tx * 0.95, ez + nz * 1.4 + tz * 0.95), [wx, wz] = localToWorldXZ(bId, ix, iz);
    return { floor: 1, bId, pos: new THREE.Vector3(x, y, z), yaw: yawFromDir(wx - x, wz - z), pitch: -0.14 };
  }
  _roomSpot(r) {
    const u = this.unit;
    if (OUTDOOR.has(r.kind)) {
      const bp = this.apt && this.apt.balconyPoint;
      const useBp = bp && r.level === (bp.level || 0) && (!r.poly || pointInPoly([bp.u, bp.v], r.poly));
      const [pu, pv] = useBp ? [bp.u, bp.v] : r.center;
      return { floor: u.floor, pos: this._unitPoint(pu, pv), yaw: this._unitDirYaw(0, 1), free: true, room: r };
    }
    // Stand back from the room centre (toward the corridor) and look toward the facade.
    const vs = r.poly ? r.poly.map(p => p[1]) : [r.center[1]];
    const v = Math.max(Math.min(...vs) + 0.8, Math.min(r.center[1], Math.min(...vs) + 1.4));
    return { floor: u.floor, pos: this._unitPoint(r.center[0], this.mode === '360' ? r.center[1] : v), yaw: this._unitDirYaw(0, 1), free: true, room: r };
  }

  async _goto(where, { instant = false, skipFloor = false } = {}) {
    if (this.riding || !this.unit) return;
    if (!instant) await this._fade(true);
    try {
      let s = this._spot(where);
      const bId = s.bId || this.unit.building;
      if (skipFloor && !s.spawn) { this.floor = s.floor; this.bId = bId; }   // commons follow in _streamWorld
      else await this._setFloor(bId, s.floor);
      if (this.disposed) return;
      if (s.outdoor) { this._initOutdoor(); s = this._outdoorSpot(bId, s.outdoor) || { floor: 1, spawn: true }; }   // no entrance data → the lobby
      if (s.spawn) {
        const cs = this.commons && this.commons.spawn, sp = cs && isFinite(cs.x) && isFinite(cs.z) ? cs : this._hallSpawn(bId, s.floor);
        const [x, z] = localToWorldXZ(bId, sp.x, sp.z);
        s = { floor: s.floor, pos: new THREE.Vector3(x, floorY(bId, s.floor), z), yaw: (sp.yaw || 0) + BUILDINGS[bId].rotY, free: true };
      }
      const pos = s.pos.clone();
      if (s.free) {
        const fy = this._floorAt(pos.x, pos.y + 0.3, pos.z, this._near(this.floors, pos, 2));
        if (fy !== null) pos.y = fy;
        const [fx, fz] = this._freeSpot(pos.x, pos.y, pos.z); pos.x = fx; pos.z = fz;
      }
      this._place(pos, s.yaw, s.pitch);
      if (where === 'apartment' && this.loaded.get(this.unit.id)?.fallback && this.el) this._toast(this.t('walk.noModel'), 3200);
      if (where === 'balcony' || (where && where.room && OUTDOOR.has(where.room.kind))) this._openBalconyDoorAt(pos);
      this.player.eye = this.mode === '360' ? EYE_360 : EYE;
      this._lastPlace = null;
      this._updateHud(true);
    } finally { if (!instant) await this._fade(false); }
  }

  // ======================= modes =======================
  setMode(m) {
    this.mode = m === '360' ? '360' : 'walk';
    this._applyMode();
    if (this.mode === '360') {
      // snap to the centre of the room we're in (or stay put outside the apartment)
      const r = this._currentRoom();
      if (r) {
        const s = this._roomSpot(r);
        const [fx, fz] = this._freeSpot(s.pos.x, s.pos.y, s.pos.z, 1.0);
        s.pos.x = fx; s.pos.z = fz;
        this._place(s.pos, this.player.yaw, this.player.pitch);
      }
      this.player.eye = EYE_360; this.touched360 = false;
    } else this.player.eye = EYE;
  }
  _applyMode() {
    this.root.classList.toggle('m360', this.mode === '360');
    this.el.modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === this.mode));
  }

  // ======================= photoreal mode (pano-tour.js) =======================
  // The photoreal tour is another module (pano-tour.js): pre-rendered panoramas per apartment type × design style.
  // It is available when window.VRC_PANO.has(typeId, styleId) says so (or a module was injected via opts.modules.panoTour).
  // Unit-local hand-over: {unitId, u, v, level, yaw}; yaw is the three.js camera yaw in the apartment group's frame
  // (x = u, z = v; yaw 0 looks toward −v, i.e. the corridor; world yaw = yaw + unitYaw(unit)).
  _panoApi() {
    const inj = this.mods && this.mods.panoTour;
    const reg = typeof window !== 'undefined' ? window.VRC_PANO : null;
    return { inj, reg };
  }
  _panoAvail() {
    if (!this.unit || this._panoFailed || !PROJECT.features || !PROJECT.features.photoTour) return false;
    const { inj, reg } = this._panoApi(), T = this.unit.type, S = this.styleId;
    if (reg && typeof reg.available === 'function') { try { return !!reg.available(this.unit.id, S); } catch { return false; } }
    for (const src of [reg, inj, inj && inj.VRC_PANO]) {
      if (src && typeof src.has === 'function') { try { if (src.has(T, S)) return true; } catch { /* registry optional */ } }
    }
    return false;
  }
  // The site's photo tour (app.js): window.VRC.openPhotoTour({unitId, styleId, room:{kind, index}}). Preferred over the
  // legacy in-walk pano layer; when neither exists the Live 3D ↔ Photo-real toggle is hidden.
  // PROJECT.features.photoTour is false for this project (no panoramas rendered): no toggle, no "coming soon".
  _photoTourFn() { if (!PROJECT.features || !PROJECT.features.photoTour) return null; const V = typeof window !== 'undefined' ? window.VRC : null; return V && typeof V.openPhotoTour === 'function' ? V.openPhotoTour : null; }
  // Where the walker is, as the photo tour understands it: a room kind + its 0-based index among rooms of that kind
  // (apartment), or a commons place ('corridor' | 'lobby' | 'parking' | 'lift').
  _roomRef() {
    const r = !this.riding && !this._carOf(this.player.pos) ? this._currentRoom() : null;
    if (r) {
      const same = (this.rooms || []).filter(x => x.kind === r.kind);
      return { kind: r.kind, index: Math.max(0, same.indexOf(r)), level: 0 };
    }
    const kind = this.riding || this._carOf(this.player.pos) ? 'lift' : this.floor === -1 ? 'parking' : isGround(this.floor) ? 'lobby' : 'corridor';
    return { kind, index: 0, level: 0 };
  }
  _openPhotoTour() {
    const fn = this._photoTourFn();
    if (!fn || !this.unit || this.riding) return;
    const room = this._roomRef();
    this._setPopover(false); this._hideUnitCard();
    this.keys.clear(); this.pad = { u: 0, d: 0, l: 0, r: 0 }; this.glide = null; this.player.vel.set(0, 0, 0);
    let res;
    try {
      res = fn({ unitId: this.unit.id, styleId: this.styleId, room, roomKind: room.kind, roomIndex: room.index,
        onBack: (kind, index) => this.jumpToRoom(kind ?? room.kind, index ?? room.index) });
    } catch (e) { console.warn('[walk] openPhotoTour failed', e); return; }
    // The tour covers the page: pause the live renderer until we are shown again (jumpToRoom / any touch on the live view).
    this._photoPaused = true;
    if (res && typeof res.then === 'function') res.catch(e => { console.warn('[walk] openPhotoTour failed', e); this._resumeLive(); });
  }
  _resumeLive() { if (!this._photoPaused) return; this._photoPaused = false; this.clock.getDelta(); }

  /** Jump into the live 3D at a room of the current apartment: kind ('living', 'bedroom', 'balcony'…, or 'corridor',
   *  'lobby', 'parking', 'apartment'), index = 0-based among rooms of that kind. Used by the photo-real tour to come back. */
  async jumpToRoom(kind, index = 0) {
    if (kind && typeof kind === 'object') ({ kind, index = 0 } = kind);
    this._resumeLive();
    await this._ready;
    if (this.disposed || !this.unit) return false;
    if (this._pano) await this._closePano(null);
    if (this.riding) return false;
    kind = String(kind || 'living').toLowerCase();
    if (['lobby', 'corridor', 'parking', 'apartment'].includes(kind)) { await this._goto(kind); return true; }
    if (kind === 'lift') { await this._goto('corridor'); return true; }
    const same = (this.rooms || []).filter(r => r.kind === kind);
    const r = same[Math.max(0, Math.min(same.length - 1, index | 0))]
      || (OUTDOOR.has(kind) ? (this.rooms || []).find(x => OUTDOOR.has(x.kind)) : null)
      || (this.rooms || []).find(x => x.kind === 'living');
    if (!r) { await this._goto('apartment'); return true; }
    // Switching back into another loaded apartment? _goto uses this.unit, which is the current one — fine.
    await this._goto({ room: r });
    return true;
  }

  // Has the photo tour renders for this unit (type × any style)? Unknown (no helper / manifest not loaded yet) → assume yes.
  _tourHas() {
    const V = window.VRC; if (!V || typeof V.hasPhotoTour !== 'function' || !this.unit) return true;
    try { return V.hasPhotoTour(this.unit.id) !== false; } catch { return true; }
  }
  _renderModes() {
    if (!this.el || !this.el.modes) return;
    const tour = !!this._photoTourFn(), real = !!this._pano;
    const show = tour || real || this._panoAvail();          // no photo tour anywhere → no toggle
    const avail = tour ? this._tourHas() : show;             // shown but not rendered for this unit → "coming soon"
    const key = `${show}|${avail}|${real}|${tour}`;
    if (key === this._modesKey) return;
    this._modesKey = key;
    this.el.modes.hidden = !show;
    this.root.classList.toggle('nomodes', !show);
    const [b3, bR] = this.el.modes.children;
    b3.classList.toggle('on', !real); bR.classList.toggle('on', real);
    b3.setAttribute('aria-pressed', String(!real)); bR.setAttribute('aria-pressed', String(real));
    bR.classList.toggle('off', !avail && !real);
    bR.setAttribute('aria-disabled', String(!avail && !real));
    bR.title = !avail && !real ? this.t('walk.soon') : '';
  }
  _soonTip() {
    const s = this.el.soon; s.classList.add('show');
    clearTimeout(this._soonT); this._soonT = setTimeout(() => s.classList.remove('show'), 2200);
  }
  // Load pano-tour.js in the background (it registers window.VRC_PANO and reads assets/pano/index.json) so the switch
  // knows early whether this type × style has been rendered. A missing module simply leaves the switch on "coming soon".
  _preloadPano() {
    // Legacy in-walk pano layer: opt-in only (opts.pano === true or a registry already on the page). The site's photo
    // tour (window.VRC.openPhotoTour) replaced it; probing for undeployed pano assets would only log 404s.
    if (this._panoProbe || this.opts.pano !== true && !window.VRC_PANO) return this._panoProbe;
    this._panoProbe = (async () => {
      try {
        const inj = this.mods && this.mods.panoTour;
        if (!window.VRC_PANO && !inj) this.mods.panoTour = await import('../pano-tour.js');
        const reg = window.VRC_PANO;
        if (reg && reg.ready && typeof reg.ready.then === 'function') await reg.ready;
      } catch (e) { console.info('[walk] photoreal tour not deployed yet', e && e.message); this._panoFailed = true; }
      this._modesKey = null; if (!this.disposed) this._renderModes();
    })();
    return this._panoProbe;
  }
  // The pano manifest (same file pano-tour.js reads) — fetched only once a type/style is known to exist.
  async _panoManifest() {
    if (!this._panoMan) {
      const url = new URL('../../assets/pano/index.json', import.meta.url);
      this._panoMan = fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    return this._panoMan;
  }
  // Pano points of this type/style: [{id, pos:[u, v, y], level?}] (or {id, u, v}) from the module, registry or manifest.
  async _panoPoints(mod) {
    const T = this.unit.type, S = this.styleId, reg = window.VRC_PANO;
    for (const [o, fn] of [[mod, 'panoPoints'], [mod, 'points'], [reg, 'points'], [reg, 'panoPoints']]) {
      if (o && typeof o[fn] === 'function') { try { const p = await o[fn](T, S); if (Array.isArray(p) && p.length) return p; } catch { /* next source */ } }
    }
    const m = await this._panoManifest();
    const e = m && m.types && m.types[T] && m.types[T].styles && m.types[T].styles[S];
    return e && Array.isArray(e.points) && (e.frame || 'unit') === 'unit' ? e.points : [];
  }
  async _nearestPanoPoint(mod, uv) {
    const pts = await this._panoPoints(mod);
    if (!pts.length || !uv) return pts[0] || null;
    let best = null, bd = Infinity;
    for (const p of pts) {
      const pu = p.u ?? (p.pos && p.pos[0]), pv = p.v ?? (p.pos && p.pos[1]);
      if (!isFinite(pu) || !isFinite(pv)) continue;
      const d = Math.hypot(pu - uv.u, pv - uv.v) + ((p.level || 0) !== uv.level ? 50 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    return best || pts[0];
  }
  async _openPano() {
    if (this._pano || this._panoBusy || !this.unit || this.riding || this.busy) return;
    if (!this._panoAvail()) { this._soonTip(); return; }
    const reg = window.VRC_PANO;
    if (reg && typeof reg.available === 'function' && typeof reg.open === 'function') return this._openPanoHook(reg);
    this._panoBusy = true;
    let mod = this.mods.panoTour;
    try {
      if (!mod || typeof (mod.openPanoTour || mod.default) !== 'function') mod = this.mods.panoTour = await import('../pano-tour.js');
    } catch (e) {
      console.warn('[walk] pano-tour.js unavailable', e);
      this._panoFailed = true; this._panoBusy = false; this._renderModes(); this._soonTip(); return;
    }
    const open = mod.openPanoTour || mod.default;
    if (typeof open !== 'function') { this._panoFailed = true; this._panoBusy = false; this._renderModes(); this._soonTip(); return; }
    const P = this.player, uv = this._unitUV(P.pos);
    const pt = await this._nearestPanoPoint(mod, uv);
    const yaw = wrapPi(P.yaw - unitYaw(this.unit) - BUILDINGS[this.unit.building].rotY);
    await this._fade(true);
    const host = document.createElement('div'); host.className = 'vw-pano';
    this.root.appendChild(host);
    this.keys.clear(); this.pad = { u: 0, d: 0, l: 0, r: 0 }; this.glide = null; P.vel.set(0, 0, 0);
    this._setPopover(false); this._hideUnitCard();
    const pano = this._pano = { host, handle: null, last: pt ? { u: pt.u ?? (pt.pos && pt.pos[0]), v: pt.v ?? (pt.pos && pt.pos[1]), level: pt.level || 0, yaw } : null };
    this.root.classList.add('pano'); this._renderModes();
    lsSet('vrc.walk.view', 'photo');
    try {
      pano.handle = await open(host, {
        unitId: this.unit.id, typeId: this.unit.type, styleId: this.styleId, pointId: pt ? pt.id : undefined, yaw,
        i18n: this.i18n, lang: this.lang, dir: this.dir,
        onExit: s => { this._closePano(s && typeof s === 'object' ? s : null); },   // leave photoreal → live 3D at the same place
        onSwitchTo3D: s => { this._closePano(s || null); },
      });
      if (pano.handle && pano.handle.ok === false) { this._panoFailed = true; this._closePano(null).then(() => this._soonTip()); }   // nothing rendered for it after all
    } catch (e) {
      console.warn('[walk] openPanoTour failed', e);
      this._panoFailed = true; this._closePano(null); this._soonTip();
    } finally { this._panoBusy = false; this._fade(false); }
  }
  // Photoreal via the pano hook: window.VRC_PANO.open(host, {unitId, styleId, startRoom, i18n, onExit}).
  // The live renderer is paused (the frame loop skips while this._pano is set) and resumes at the same spot on exit.
  async _openPanoHook(reg) {
    this._panoBusy = true;
    const P = this.player, room = this._currentRoom();
    const back = { pos: P.pos.clone(), yaw: P.yaw, pitch: P.pitch, floor: this.floor, bId: this.bId, unit: this.unit };
    await this._fade(true);
    const host = document.createElement('div'); host.className = 'vw-pano';
    this.root.appendChild(host);
    this.keys.clear(); this.pad = { u: 0, d: 0, l: 0, r: 0 }; this.glide = null; P.vel.set(0, 0, 0);
    this._setPopover(false); this._hideUnitCard();
    const pano = this._pano = { host, handle: null, back, hook: true };
    this.root.classList.add('pano'); this._renderModes();
    lsSet('vrc.walk.view', 'photo');
    try {
      pano.handle = await reg.open(host, {
        unitId: this.unit.id, typeId: this.unit.type, styleId: this.styleId, startRoom: (room && room.kind) || 'living',
        i18n: this.i18n, lang: this.lang, dir: this.dir,
        onExit: () => { this._closePano(null); },
      });
      if (pano.handle && pano.handle.ok === false) { this._closePano(null).then(() => this._soonTip()); }
    } catch (e) {
      console.warn('[walk] VRC_PANO.open failed', e);
      this._closePano(null); this._soonTip();
    } finally { this._panoBusy = false; this._fade(false); }
  }
  async _closePano(state, { exit = false } = {}) {
    const p = this._pano; if (!p) return;
    this._pano = null;
    let s = state;
    if (!s && p.handle && typeof p.handle.getState === 'function') { try { s = p.handle.getState(); } catch { /* optional */ } }
    s = s || p.last;
    await this._fade(true);
    for (const fn of ['close', 'dispose', 'destroy']) { if (p.handle && typeof p.handle[fn] === 'function') { try { p.handle[fn](); } catch (e) { console.warn(e); } break; } }
    p.host.remove();
    this.root.classList.remove('pano');
    this.clock.getDelta();
    this._renderModes();
    if (!this.disposed) lsSet('vrc.walk.view', 'live');
    if (exit) { this._fade(false); return this.opts.onExit && this.opts.onExit(); }
    if (p.hook && !state) {   // resume exactly where we left the live view
      const b = p.back;
      try { if (b.floor !== this.floor || b.bId !== this.bId) await this._setFloor(b.bId, b.floor); } catch (e) { console.warn(e); }
      this._place(b.pos, b.yaw, b.pitch);
      this.player.eye = this.mode === '360' ? EYE_360 : EYE;
      this._lastPlace = null;
    } else try { if (s) await this._placeFromPano(s); } catch (e) { console.warn('[walk] pano hand-over', e); }
    this._updateHud(true);
    this._fade(false);
  }
  // Put the walker where the photoreal tour left off (pano point position + view yaw), in the right apartment.
  async _placeFromPano(s) {
    if (s.frame === 'building' && isFinite(s.x) && isFinite(s.z) && BUILDINGS[s.building || this.bId]) {   // commons panoramas
      const bId = s.building || this.bId, fl = isFinite(s.floor) ? s.floor : this.floor;
      if (this.floor !== fl || this.bId !== bId) await this._setFloor(bId, fl);
      const [wx, wz] = localToWorldXZ(bId, s.x, s.z), pos = new THREE.Vector3(wx, floorY(bId, fl), wz);
      const [fx, fz] = this._freeSpot(pos.x, pos.y, pos.z, 1.0); pos.x = fx; pos.z = fz;
      this._place(pos, isFinite(s.yaw) ? s.yaw + BUILDINGS[bId].rotY : this.player.yaw);
      return;
    }
    if (!isFinite(s.u) || !isFinite(s.v)) return;
    let unit = (s.unitId && unitById(s.unitId)) || this.unit;
    if (unit !== this.unit) {
      const e = this.loaded.get(unit.id);
      if (e) this._setCurrent(e, { quiet: true });
      else if (unit.building === this.bId && unit.floor === this.floor) { const n = this._loadApt(unit); this._evict(n); this._setCurrent(n, { quiet: true }); }
      else unit = this.unit;
    }
    if (this.floor !== unit.floor || this.bId !== unit.building) await this._setFloor(unit.building, unit.floor);
    const [x, z] = unitToWorld(unit, s.u, s.v);
    const pos = new THREE.Vector3(x, floorY(unit.building, unit.floor), z);
    const fy = this._floorAt(pos.x, pos.y + 0.3, pos.z, this._near(this.floors, pos, 2));
    if (fy !== null) pos.y = fy;
    const [fx, fz] = this._freeSpot(pos.x, pos.y, pos.z, 1.0); pos.x = fx; pos.z = fz;
    const yaw = isFinite(s.yaw) ? s.yaw + unitYaw(unit) + BUILDINGS[unit.building].rotY : this.player.yaw;
    this._place(pos, yaw, isFinite(s.pitch) ? Math.max(-0.6, Math.min(0.6, s.pitch)) : -0.04);
    this.player.eye = this.mode === '360' ? EYE_360 : EYE;
    this._lastPlace = null;
  }

  // ======================= actions (doors, lifts) =======================
  _pickAt(clientX, clientY, forFloor = false) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = this._ray; ray.setFromCamera(ndc, this.camera);
    const origin = ray.ray.origin.clone(), dir = ray.ray.direction.clone();
    const objs = new Set();
    const near = (l, rr) => this._near(l, origin, rr).forEach(o => objs.add(o));
    this._solidsNear(origin, 12, this.player.pos).forEach(o => objs.add(o)); near(this.floors, forFloor ? 40 : 12); this.actions.forEach(a => a.o.parent && objs.add(a.o));
    const hits = this._cast([...objs], origin, dir, forFloor ? 40 : 12);
    if (!hits.length) return null;
    // Wall-mounted controls (call plates, keys) sit within millimetres of wall colliders: an action hit just behind
    // the first surface still wins.
    for (const h of hits) { if (h.distance - hits[0].distance > 0.05) break; if (this._actionOf(h)) return h; }
    // An open sliding balcony door is parked over its fixed neighbour pane: seen from the room the leaf is behind that
    // glass, so a tap on the pane reaches the leaf (to close it).
    if (!forFloor) for (const h of hits) { if (h.distance - hits[0].distance > 0.3) break; if (h.object.userData.balconyDoor) return h; }
    return hits[0];
  }
  _actionOf(hit) {
    if (!hit) return null;
    let o = hit.object;
    while (o) { if (o.userData && o.userData.action) return { action: o.userData.action, obj: o, hit }; o = o.parent; }
    return null;
  }

  async _doAction(a) {
    const act = a.action;
    if (act.type === 'aptDoor' && act.part === 'balconyDoor') return this._tapBalconyDoor(a);
    if (act.type === 'aptDoor') return act.part ? (this._click?.(0.35), this._toggleDoor(a.obj)) : this._onAptDoor(act.unitId, a.obj);
    if (act.type === 'doorbell') return this._ringBell(a);
    if (act.type === 'aptMonitor') return this._monitorOpen(act.unitId);
    if (act.type === 'intercom') return this._icShow(act);
    if (act.type === 'liftCall') return this._callLift(act.stair, act.building, a.obj, a.hit && a.hit.object, a.hit);
    if (act.type === 'liftButton') return this._pressLiftButton(act.floor, act);
    if (act.type === 'liftDoor') return this._liftDoorKey(act);
    if (act.type === 'liftAlarm') return this._liftAlarm(act);
    if (act.type === 'concierge') { const cg = ((this.commons && this.commons.concierges) || []).find(c => c.group === a.obj); if (cg) { this._click(0.35); return this._cgShow(cg, { auto: false }); } return; }
    if (typeof act.onClick === 'function') return act.onClick();
  }

  // Any apartment door on the corridor: loaded → swing it; not loaded → build that apartment behind it, then swing it open.
  async _onAptDoor(unitId, obj) {
    if (this.riding) return;
    const e = unitId && this.loaded.get(unitId);
    if (e) {
      const leaf = e.apt.doorLeaf || obj;
      const opening = !leaf.userData._open;
      if (opening) this._click(0.5);
      await this._toggleDoor(leaf);
      if (opening && e.apt !== this.apt) this._setCurrent(e);
      return;
    }
    const unit = unitId && unitById(unitId);
    if (!unit) return this._toggleDoor(obj);
    if (unit.building !== this.bId || unit.floor !== this.floor) return;   // doors of other floors are irrelevant
    return this._openNeighbour(unit, obj);
  }

  async _openNeighbour(unit, leaf) {
    if (this._opening) return;
    this._opening = unit.id;
    this._click(0.5);
    const stop = this._shimmer(leaf);
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 90))));   // let the shimmer show before the sync build
      if (this.disposed) return;
      const e = this._loadApt(unit);
      this._evict(e);
      try { if (this.renderer.compile) this.renderer.compile(e.apt.group, this.camera, this.scene); } catch { /* optional warm-up */ }
      stop();
      this._setCurrent(e);
      if (e.apt.doorLeaf) await this._toggleDoor(e.apt.doorLeaf, true);
      if (e.apt.doorLeaf) e.apt.doorLeaf.userData._autoDone = true;
    } catch (err) { console.warn('[walk] open neighbour', err); stop(); }
    finally { this._opening = null; }
  }

  // Subtle gold shimmer on a corridor door leaf while its apartment is being built.
  _shimmer(leaf) {
    if (!leaf || !leaf.material || Array.isArray(leaf.material)) return () => {};
    const orig = leaf.material, m = orig.clone();
    m.emissive = new THREE.Color(0xe6c987); m.emissiveIntensity = 0;
    leaf.material = m;
    let alive = true;
    const t0 = performance.now();
    const step = () => { if (!alive) return; const t = (performance.now() - t0) / 1000; m.emissiveIntensity = 0.12 + 0.12 * Math.sin(t * 9); requestAnimationFrame(step); };
    step();
    return () => { if (!alive) return; alive = false; leaf.material = orig; m.dispose(); };
  }

  _fillUnitCard(u) {
    const T = TYPES[u.type] || {};
    this.el.u1.textContent = (this.i18n && typeof this.i18n.unitLabel === 'function' && this.i18n.unitLabel(u)) || unitLabel(u);
    this.el.u2.innerHTML = '';
    const avail = !u.status || u.status === 'available';
    const parts = [];
    if (T.rooms) parts.push(['span', `${T.rooms} ${this.t('walk.roomsN')}`]);
    if (T.total) parts.push(['span', this._area(T.total)]);
    const pr = avail ? (u.price ? money(u.price) : '') : this.t('walk.status.' + u.status, u.status);
    if (pr) parts.push(['b', pr]);
    parts.forEach(([tag, txt], i) => {   // each part is bidi-isolated so "61 m²" / "1 794 000 ₴" never get reordered in RTL
      if (i) this.el.u2.append(document.createTextNode(' · '));
      const el = document.createElement(tag); el.textContent = txt; el.style.unicodeBidi = 'isolate'; el.dir = 'auto'; this.el.u2.append(el);
    });
    this.el.ureserve.style.display = avail ? '' : 'none';
  }
  // "34,50 м²" in uk / ru (decimal comma), "34.50 m²" elsewhere — the printed total area of the plans
  _area(n) { const cyr = ['uk', 'ru'].includes(String(this.lang).slice(0, 2)); return cyr ? `${n.toFixed(2).replace('.', ',')} м²` : `${n.toFixed(2)} m²`; }
  _showUnitCard(u, ms = 7000) {
    if (!this.el || !u) return;
    this._cardUnit = u; this._fillUnitCard(u);
    this.el.toast.classList.remove('show');
    this.el.ucard.classList.add('show');
    this._poke();
    clearTimeout(this._cardT); this._cardT = setTimeout(() => this._hideUnitCard(), ms);
  }
  _hideUnitCard() { if (!this.el) return; clearTimeout(this._cardT); this.el.ucard.classList.remove('show'); }

  // ---- small UI sounds (WebAudio, only after a user gesture) ----
  _audio() {
    try {
      const ua = navigator.userActivation; if (ua && !ua.hasBeenActive) return null;
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      this._ac = this._ac || new AC();
      if (this._ac.state === 'suspended') this._ac.resume().catch(() => {});
      return this._ac;
    } catch { return null; }
  }
  _click(vol = 1) {   // soft mechanical key click
    const ac = this._audio(); if (!ac) return;
    try {
      const t = ac.currentTime + 0.005, n = Math.floor(ac.sampleRate * 0.03), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.12));
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.4;
      const g = ac.createGain(); g.gain.value = 0.22 * vol;
      src.connect(f).connect(g).connect(ac.destination); src.start(t);
      const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.value = 1850;
      og.gain.setValueAtTime(0.04 * vol, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(og).connect(ac.destination); o.start(t); o.stop(t + 0.08);
    } catch { /* optional */ }
  }
  _bell() {
    const ac = this._audio(); if (!ac) return;
    try {
      const t0 = ac.currentTime + 0.01;
      for (let i = 0; i < 6; i++) {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = 2100;
        const t = t0 + i * 0.16; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.15);
      }
    } catch { /* optional */ }
  }

  // ======================= doorbells, door-entry monitor, entrance intercom =======================
  _sfx(k, n) { const l = (this._sfxLog ||= []); l.push({ k, n, t: this._ac ? +this._ac.currentTime.toFixed(3) : 0 }); if (l.length > 40) l.shift(); }
  // One enveloped oscillator → destination node; returns the node count (for the sound log)
  _osc(ac, out, type, f, t, dur, vol, a = 0.008) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  _dingDong() {   // two struck chime bars a major third apart (E5 → C5), each with a few inharmonic partials
    const ac = this._audio(); if (!ac) return 0;
    try {
      const t0 = ac.currentTime + 0.03, out = ac.createGain(); out.gain.value = 0.85; out.connect(ac.destination);
      for (const [f, dt] of [[659.25, 0], [523.25, 0.44]]) for (const [mul, vol, dec] of [[1, 0.17, 1.6], [2, 0.05, 0.95], [2.76, 0.03, 0.5], [5.4, 0.012, 0.22]]) this._osc(ac, out, 'sine', f * mul, t0 + dt, dec, vol);
      this._sfx('dingdong', 16);
    } catch { /* optional */ }
    return 1500;
  }
  _icKeyTone(d) {   // DTMF pair of the key
    const ac = this._audio(); if (!ac) return;
    try {
      const i = '123456789*0#'.indexOf(String(d)), t = ac.currentTime + 0.005;
      const lo = [697, 770, 852, 941][i < 0 ? 3 : (i / 3) | 0], hi = [1209, 1336, 1477][i < 0 ? 1 : i % 3];
      for (const f of [lo, hi]) this._osc(ac, ac.destination, 'sine', f, t, 0.11, 0.035, 0.004);
      this._sfx('key', 4);
    } catch { /* optional */ }
  }
  _icRing(bursts = 2) {   // ringback tone: 425 Hz bursts
    const ac = this._audio(), on = 0.85, gap = 0.5; if (!ac) return bursts * (on + gap) * 1000;
    try {
      const t0 = ac.currentTime + 0.05;
      for (let i = 0; i < bursts; i++) {
        const t = t0 + i * (on + gap), g = ac.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.055, t + 0.03); g.gain.setValueAtTime(0.055, t + on - 0.05); g.gain.linearRampToValueAtTime(0, t + on);
        g.connect(ac.destination);
        for (const f of [425, 850.6]) { const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.value = f; og.gain.value = f > 500 ? 0.18 : 1; o.connect(og).connect(g); o.start(t); o.stop(t + on + 0.02); }
      }
      this._sfx('ring', bursts * 5);
    } catch { /* optional */ }
    return bursts * (on + gap) * 1000;
  }
  _icAnswer() {   // pick-up: two rising notes
    const ac = this._audio(); if (!ac) return;
    try { const t = ac.currentTime + 0.02; this._osc(ac, ac.destination, 'sine', 784, t, 0.2, 0.06); this._osc(ac, ac.destination, 'sine', 1046.5, t + 0.14, 0.34, 0.06); this._sfx('answer', 4); } catch { /* optional */ }
  }
  _icBuzz(k = 1) {   // door-strike buzz: mains-hum sawtooth through a low-pass, with a clack at each end
    const ac = this._audio(); if (!ac) return;
    try {
      const t = ac.currentTime + 0.02, dur = 1.1 * k, g = ac.createGain(), lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.8;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.015); g.gain.setValueAtTime(0.06, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
      lp.connect(g).connect(ac.destination);
      for (const [type, f] of [['sawtooth', 100], ['square', 200.7]]) { const o = ac.createOscillator(), og = ac.createGain(); o.type = type; o.frequency.value = f; og.gain.value = type === 'square' ? 0.35 : 1; o.connect(og).connect(lp); o.start(t); o.stop(t + dur + 0.02); }
      for (const tt of [t, t + dur]) this._osc(ac, ac.destination, 'triangle', 180, tt, 0.07, 0.07, 0.002);
      this._sfx('buzz', 8);
    } catch { /* optional */ }
  }
  _icError() {
    const ac = this._audio(); if (!ac) return;
    try { const t = ac.currentTime + 0.01; for (const dt of [0, 0.17]) this._osc(ac, ac.destination, 'square', 233, t + dt, 0.13, 0.03); this._sfx('error', 4); } catch { /* optional */ }
  }

  // Tap on a bell push (one InstancedMesh per floor): press it, chime, and after a beat the door opens as on a door tap.
  _ringBell(a) {
    const ids = a.obj.userData.bellUnits, i = a.hit ? a.hit.instanceId : null;
    const unitId = ids && i != null ? ids[i] : null;
    if (unitId) return this._pressBell(unitId);
  }
  async _pressBell(unitId) {
    if (this.riding || this._bellBusy) return;
    this._bellBusy = unitId;
    try {
      const c = this.commons, u = unitById(unitId);
      this._click(0.6);
      if (c && c.bells) c.bells.press(unitId, 1100);
      this._dingDong();
      this._monitorRing(unitId);
      if (u) this._toast(this.t('walk.bell.ring').replace('{n}', u.apNo), 1900);
      await this._sleep(1150);
      if (this.disposed || this.riding) return;
      const e = this.loaded.get(unitId);
      if (e) { const leaf = e.apt.doorLeaf; if (leaf && !leaf.userData._open) await this._onAptDoor(unitId, leaf); return; }
      const leaf = this.commons && this.commons.leafOf ? this.commons.leafOf(unitId) : null;
      if (!leaf) return;
      await this._onAptDoor(unitId, leaf);
      this._monitorRing(unitId, 2600);   // the apartment behind the door has just been built: its monitor is still ringing
    } finally { this._bellBusy = null; }
  }
  // The video monitor on the hall wall by the entrance door of a loaded apartment (shared parts, see monitorParts).
  _addMonitor(e) {
    try {
      const M = monitorParts(), u = e.unit, apt = e.apt, P = apt.plan || {};
      const ul = P.ul ?? 0.1, vc = P.vc ?? 0.15, du = P.doorU ?? (apt.entrance && apt.entrance.u) ?? u.door.u;
      // free stretch of the corridor wall on the latch side: between the hall wardrobe / laundry tower and the architrave
      const gap = du - 0.5 - ul, left = ul + (gap >= 0.62 ? 0.66 : 0.02), right = du - 0.6;
      const h = new THREE.Group(); h.name = 'walk-door-monitor';
      h.position.copy(apt.group.position); h.rotation.y = apt.group.rotation.y;
      const g = new THREE.Group();
      if (right - left >= 0.32) g.position.set(Math.max(left + 0.14, right - 0.17), 1.43, vc + 0.001);
      else { g.position.set(ul + 0.001, 1.43, vc + (gap >= 0.62 ? 0.7 : 0.42)); g.rotation.y = Math.PI / 2; }   // no room there: the party wall
      const body = new THREE.Mesh(M.body, M.shell), face = new THREE.Mesh(M.face, M.idle);
      face.userData.action = { type: 'aptMonitor', unitId: u.id };
      g.add(body, face); h.add(g); this.scene.add(h); h.updateMatrixWorld(true);
      this._register(h, e.src);
      let timer = 0;
      e.monitor = {
        group: h, face,
        ring: (ms = 2600) => { face.material = M.ring; clearTimeout(timer); timer = setTimeout(() => { face.material = M.idle; }, ms); },
        dispose: () => { clearTimeout(timer); if (h.parent) h.parent.remove(h); },
      };
    } catch (err) { console.warn('[walk] door monitor', err); }
  }
  _monitorRing(unitId, ms) { const e = this.loaded.get(unitId); if (e && e.monitor) e.monitor.ring(ms); }
  async _monitorOpen(unitId) {   // the "door" key of the monitor releases the entrance door
    const e = this.loaded.get(unitId); if (!e) return;
    this._click(0.5); this._icBuzz(0.4);
    const leaf = e.apt.doorLeaf;
    if (leaf && !leaf.userData._open) { this._toast(this.t('walk.mon.open'), 1500); await this._toggleDoor(leaf, true); }
  }

  // ---- entrance video intercom (commons.intercoms; tap → HUD dialog)
  _icUnits(bId) {
    const m = (this._icMaps ||= {});
    if (!m[bId]) { const map = new Map(); for (const u of UNITS) if (u.building === bId) map.set(String(u.apNo), u); m[bId] = map; }
    return m[bId];
  }
  _icShow(act) {
    if (!this.el || this.riding || this.drive) return;
    if (!this.el.ic) {
      const d = document.createElement('div'); d.className = 'vw-cg vw-ic vw-panel'; d.setAttribute('role', 'dialog');
      d.innerHTML = `<div class="hd"><span class="av" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e6c987" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2"/><circle cx="12" cy="6.6" r="1.6"/><rect x="9" y="10" width="6" height="3.6" rx=".6"/><path d="M9.3 16.4h.1M12 16.4h.1M14.7 16.4h.1M9.3 18.8h.1M12 18.8h.1M14.7 18.8h.1"/></svg></span>
        <div class="who"><b></b><span></span></div><button class="ib" data-ic="close">✕</button></div><div class="body"></div>`;
      this.el.hud.appendChild(d); this.el.ic = d;
    }
    this._click(0.4);
    if (this._cgOpen) this._cgClose();
    this._ic = { bId: act.building, stair: act.stair, num: '', view: 'pad', unit: null, err: false, tok: 0 };
    this._icOpen = true;
    this._icRender();
    this.el.ic.classList.add('show');
  }
  _icClose() {
    this._icOpen = false;
    if (this._ic) this._ic.tok++;
    if (this.el && this.el.ic) this.el.ic.classList.remove('show');
  }
  _icUnitLine(u) { return `${u.apNo} · ${this._floorName(u.floor)}`; }
  _icRender() {
    const d = this.el && this.el.ic, ic = this._ic; if (!d || !ic) return;
    const t = k => this.t('walk.ic.' + k), esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    d.dir = this.dir; d.lang = this.lang; d.setAttribute('aria-label', t('title'));
    d.querySelector('.who b').textContent = t('title');
    d.querySelector('.who span').textContent = this._bName(ic.bId);
    const x = d.querySelector('[data-ic=close]'); x.title = t('close'); x.setAttribute('aria-label', t('close'));
    const body = d.querySelector('.body'), map = this._icUnits(ic.bId), mine = this.unit && this.unit.building === ic.bId ? this.unit : null;
    if (ic.view === 'calling') {
      body.innerHTML = `<div class="disp calling">${ic.unit ? esc(ic.unit.apNo) : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5 17a7 7 0 0 1 14 0z"/><path d="M3.5 19.5h17M12 10V8"/></svg>'}</div>
        <div class="info" aria-live="polite">${esc(ic.unit ? t('calling').replace('{n}', ic.unit.apNo) : t('callingCg'))}</div>
        <div class="acts"><button class="wide" data-ic="again">${esc(t('close'))}</button></div>`;
      return;
    }
    if (ic.view === 'answered') {
      const u = ic.unit;
      body.innerHTML = `<div class="disp ok">✓ ${esc(u.apNo)}</div>
        <p class="msg" aria-live="polite">${esc(t('answer').replace('{n}', u.apNo))}</p>
        <div class="acts"><button class="pri" data-ic="go" style="grid-column:1/-1"><i>⌂</i><span>${esc(t('goApt'))}<small>${esc(this._icUnitLine(u))}</small></span></button>
        <button data-ic="enter"><i>⇥</i><span>${esc(t('enter'))}</span></button><button data-ic="again"><i>#</i><span>${esc(t('again'))}</span></button>
        <button class="wide" data-ic="close">${esc(t('close'))}</button></div>`;
      return;
    }
    const hit = ic.num ? map.get(ic.num) : null, nos = [...map.keys()].map(Number);
    const info = hit ? ['ok', this._icUnitLine(hit)] : ic.err && ic.num ? ['err', t('none').replace('{n}', ic.num)] : ['', t('range').replace('{a}', Math.min(...nos)).replace('{b}', Math.max(...nos))];
    const here = [...map.values()].sort((a, b) => a.apNo - b.apNo);   // one entrance per tower: every flat of the building
    body.innerHTML = `<div class="disp${ic.num ? '' : ' empty'}">${esc(ic.num || t('prompt'))}</div>
      <div class="info ${info[0]}" aria-live="polite">${esc(info[1])}</div>
      <div class="lst"><span>${esc(t('stair'))}</span>${here.map(u => `<button data-ic="u" data-n="${u.apNo}"${u === mine ? ' class="mine"' : ''}>${u.apNo}</button>`).join('')}</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-ic="d" data-n="${n}">${n}</button>`).join('')}
        <button class="del" data-ic="del" aria-label="${esc(t('del'))}" title="${esc(t('del'))}">⌫</button><button data-ic="d" data-n="0">0</button>
        <button class="call" data-ic="call" aria-label="${esc(t('call'))}" title="${esc(t('call'))}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 3.2 9 3l1.5 4.2-1.9 1.5a11 11 0 0 0 6.7 6.7l1.5-1.9L21 15l-.2 2.4a3.4 3.4 0 0 1-3.6 3.2C10 20 4 14 3.4 6.8a3.4 3.4 0 0 1 3.2-3.6z"/></svg></button></div>
      <div class="acts">${mine ? `<button data-ic="mine"><i>⌂</i><span>${esc(t('mine'))}<small>${esc(mine.apNo)}</small></span></button>` : ''}
        <button data-ic="cg"${mine ? '' : ' style="grid-column:1/-1"'}><i>✦</i><span>${esc(t('concierge'))}</span></button>
        <button class="wide" data-ic="close">${esc(t('close'))}</button></div>`;
    const lst = body.querySelector('.lst'), cur = lst.querySelector(ic.num ? `[data-n="${ic.num}"]` : '.mine');   // keep the typed / own number in view (LTR and RTL)
    if (cur) { const a = cur.getBoundingClientRect(), r = lst.getBoundingClientRect(); lst.scrollLeft += a.left + a.width / 2 - r.left - r.width / 2; }
  }
  async _icAction(k, b) {
    const ic = this._ic; if (!ic) return;
    if (k === 'close') { this._click(0.3); return this._icClose(); }
    if (k === 'd') { if (ic.num.length < 3) ic.num += b.dataset.n; ic.err = false; this._icKeyTone(b.dataset.n); return this._icRender(); }
    if (k === 'del') { ic.num = ic.num.slice(0, -1); ic.err = false; this._click(0.3); return this._icRender(); }
    if (k === 'u') { ic.num = String(b.dataset.n); ic.err = false; this._icKeyTone('#'); return this._icRender(); }
    if (k === 'again') { this._click(0.3); ic.tok++; ic.view = 'pad'; ic.num = ''; ic.unit = null; ic.err = false; return this._icRender(); }
    if (k === 'mine' && this.unit) ic.num = String(this.unit.apNo);
    if (k === 'call' || k === 'mine') {
      const u = this._icUnits(ic.bId).get(ic.num);
      if (!u) { ic.err = true; this._icError(); return this._icRender(); }
      return this._icCall(u);
    }
    if (k === 'cg') return this._icCall(null);
    if (k === 'enter') { this._click(0.3); this._icClose(); return this._walkIn(ic.bId, ic.stair); }
    if (k === 'go') { this._click(0.3); return this._icGoApt(); }
  }
  // Ring an apartment (or the concierge when unit is null): ringback → pick-up → door-strike buzz → the lobby doors open.
  async _icCall(unit) {
    const ic = this._ic, tok = ++ic.tok, stale = () => this.disposed || !this._icOpen || ic !== this._ic || ic.tok !== tok;
    ic.view = 'calling'; ic.unit = unit; this._icRender();
    this._icKeyTone('#');
    await this._sleep(260); if (stale()) return;
    await this._sleep(this._icRing(unit ? 2 : 1)); if (stale()) return;
    this._icAnswer();
    await this._sleep(520); if (stale()) return;
    this._icBuzz();
    this._releaseEntrance(ic.bId, ic.stair);
    if (unit) { ic.view = 'answered'; return this._icRender(); }
    this._icClose();
    const cg = ((this.commons && this.commons.concierges) || [])[0];
    if (cg) this._cgShow(cg, { auto: false, stair: ic.stair });
  }
  _releaseEntrance(bId, stair) {
    (this._entryOpen ||= {})[bId + ':' + stair] = performance.now();
    const c = this.commons, rec = c && c.bId === bId && (c.intercoms || []).find(i => i.stair === stair);
    if (rec) rec.setOpen(true);
  }
  // Walk the visitor from the forecourt through the (released) lobby doors into the lobby.
  async _walkIn(bId, stair) {
    const c = coresOf(bId, 1)[0]; if (!c || !c.entrance || !c.entranceNormal || this.riding || this.busy) return;
    const P = this.player, [ex, ez] = c.entrance, [nx, nz] = c.entranceNormal;   // n points outward
    const pts = [[ex + nx * 0.9, ez + nz * 0.9], [ex - nx * 2.7, ez - nz * 2.7]].map(([x, z]) => localToWorldXZ(bId, x, z));
    this._releaseEntrance(bId, stair);
    this.busy = true; this.glide = null;
    try {
      await this._sleep(380);   // the leaves start to slide
      for (const [x, z] of pts) {
        const from = P.pos.clone(), L = Math.hypot(x - from.x, z - from.z); if (L < 0.05) continue;
        const fy = P.yaw, ty = fy + wrapPi(yawFromDir(x - from.x, z - from.z) - fy);
        await tween(Math.min(2600, Math.max(520, L * 560)), k => { P.pos.x = from.x + (x - from.x) * k; P.pos.z = from.z + (z - from.z) * k; P.tYaw = P.yaw = fy + (ty - fy) * Math.min(1, k * 2.2); P.tPitch = P.pitch = P.pitch * (1 - k * 0.5); P.vel.set(0, 0, 0); });
        if (this.disposed) return;
      }
      this._hideFloorsForWalker(true);
    } finally { this.busy = false; }
  }
  // Take the lift of a staircase to another floor: call it, step in, press the key, ride.
  async _rideTo(floor, stair, bId = this.bId) {
    if (this.riding || this.busy) return false;
    if (floor === this.floor) return true;
    await this._callLift(stair, bId);
    const inf = this._carOf(this.player.pos);
    if (!inf) return false;
    await this._pressKey(inf, floor);
    return this.floor === floor;
  }
  async _icGoApt() {
    const ic = this._ic, u = ic && ic.unit; if (!u) return;
    this._icClose();
    if (this.busy || this.riding || this.drive) return;
    if (this._isOutside()) await this._walkIn(ic.bId, ic.stair);
    if (this.disposed) return;
    if (u.floor !== this.floor || u.building !== this.bId) {
      this._toast(this.t('walk.cg.going'), 2200);
      if (!(await this._rideTo(u.floor, ic.stair, ic.bId))) return;
    }
    await this._goto(u === this.unit ? 'corridor' : { door: u });
    this._toast(this.t('walk.bell.hint'), 2800);
  }
  _intercomTick() {
    if (!this._icOpen) return;
    const ic = this._ic, c = this.commons, rec = c && c.bId === ic.bId && (c.intercoms || []).find(i => i.stair === ic.stair);
    if (!rec || this.riding || this.drive) return this._icClose();
    const [x, z] = localToWorldXZ(ic.bId, rec.x, rec.z), P = this.player.pos;
    if (Math.hypot(P.x - x, P.z - z) > 7) this._icClose();
  }

  _toggleDoor(leaf, open) {
    if (typeof leaf.userData.toggle === 'function') return leaf.userData.toggle(open);
    if (leaf.userData._anim) return;
    const want = open ?? !leaf.userData._open;
    if (want === !!leaf.userData._open) return;
    let pivot = leaf.userData._pivot;
    if (!pivot) {
      // Build a hinge pivot at one vertical edge of the leaf (in its parent's frame) and swing it into the apartment.
      const parent = leaf.parent;
      parent.updateMatrixWorld(true);
      const wb = new THREE.Box3().setFromObject(leaf);
      const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      const lb = new THREE.Box3();
      for (let i = 0; i < 8; i++) lb.expandByPoint(new THREE.Vector3(i & 1 ? wb.max.x : wb.min.x, i & 2 ? wb.max.y : wb.min.y, i & 4 ? wb.max.z : wb.min.z).applyMatrix4(inv));
      const sx = lb.max.x - lb.min.x, sz = lb.max.z - lb.min.z, alongX = sx >= sz;
      const inward = new THREE.Vector3(0, 0, 1);
      if (this.aptGroup) inward.transformDirection(this.aptGroup.matrixWorld); else inward.set(0, 0, 1);
      inward.transformDirection(inv);   // world → parent-local direction
      pivot = new THREE.Object3D(); pivot.name = 'walk-door-hinge';
      if (alongX) pivot.position.set(lb.min.x, 0, (lb.min.z + lb.max.z) / 2); else pivot.position.set((lb.min.x + lb.max.x) / 2, 0, lb.min.z);
      parent.add(pivot); pivot.updateMatrixWorld(true); pivot.attach(leaf);
      leaf.userData._pivot = pivot;
      leaf.userData._angle = alongX ? (inward.z > 0 ? -1 : 1) * 1.62 : (inward.x > 0 ? 1 : -1) * 1.62;
      this._own.push(pivot);
    }
    leaf.userData._anim = true;
    const from = pivot.rotation.y, to = want ? leaf.userData._angle : 0;
    return tween(750, k => { pivot.rotation.y = from + (to - from) * k; pivot.updateMatrixWorld(true); })
      .then(() => { leaf.userData._open = want; leaf.userData._anim = false; });
  }

  _nearestLift(stair, needOpen = false, building = null) {
    const P = this.player.pos;
    let best = null, bd = Infinity;
    for (const inf of this.liftInfos) {
      if (stair != null && inf.stair !== stair) continue;
      if (building && BUILDINGS[building] && inf.bId !== building) continue;
      const [x, z] = localToWorldXZ(inf.bId, inf.door[0], inf.door[1]);
      let d = Math.hypot(P.x - x, P.z - z);
      if (needOpen && !inf.lift.doorsOpen) d += 5;
      if (d < bd) { bd = d; best = inf; }
    }
    return best;
  }
  _carWorld(inf) { const [x, z] = localToWorldXZ(inf.bId, inf.car[0], inf.car[1]); return [x, z]; }
  _carOf(pos) {
    for (const inf of this.liftInfos) {
      const [lx, lz] = worldToLocal(inf.bId, pos.x, pos.z);
      const dx = lx - inf.door[0], dz = lz - inf.door[1];
      const depth = -(dx * inf.n[0] + dz * inf.n[1]);           // metres behind the landing door
      const lat = Math.abs(dx * inf.n[1] - dz * inf.n[0]);
      if (depth > 0.15 && depth < inf.carDepth * 2 && lat < 0.9 && Math.abs(pos.y - floorY(inf.bId, inf.floor)) < 1) return inf;
    }
    return null;
  }

  _infOfAction(act) {
    if (!act) return null;
    return this.liftInfos.find(i => i.core === act.core && i.doorIndex === act.doorIndex && (act.stair == null || i.stair === act.stair) && (act.building == null || i.bId === act.building)) || null;
  }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Landing call plate: the tapped key lights, the car arrives, doors open, we step in and turn to the panel.
  async _callLift(stair, building, plate, hitObj, hit) {
    const inf = this._nearestLift(stair, true, building) || this._nearestLift(stair, true);
    if (!inf || this.busy || this.riding) return;
    this.busy = true; this.glide = null;
    const light = plate && plate.userData && typeof plate.userData.light === 'function' ? plate.userData.light : null;
    if (plate && hit && (!hitObj || hitObj === plate)) {   // tapped the plate body → light the key nearest the finger
      let bd = Infinity; const v = new THREE.Vector3();
      for (const c of plate.children) if (c.userData && c.userData.dir) { const d = c.getWorldPosition(v).distanceTo(hit.point); if (d < bd) { bd = d; hitObj = c; } }
    }
    try {
      this._click();
      if (light) light(true, hitObj);
      if (!inf.lift.doorsOpen) { await this._sleep(650); await inf.lift.open(); }
      else await this._sleep(250);
      if (light) light(false);
      await this._walkIntoCar(inf);
    } catch (e) { console.warn('[walk] lift call', e); if (light) light(false); }
    finally { this.busy = false; }
  }
  async _walkIntoCar(inf) {
    const P = this.player, [cx, cz] = this._carWorld(inf);
    const from = P.pos.clone(), fy = P.yaw;
    const midYaw = fy + wrapPi(yawFromDir(cx - from.x, cz - from.z) - fy);
    const dur = Math.min(1400, Math.max(700, from.distanceTo(new THREE.Vector3(cx, from.y, cz)) * 420));
    await tween(dur, k => { P.pos.x = from.x + (cx - from.x) * k; P.pos.z = from.z + (cz - from.z) * k; P.tYaw = P.yaw = fy + (midYaw - fy) * Math.min(1, k * 2.5); P.tPitch = P.pitch = P.pitch * (1 - k); P.vel.set(0, 0, 0); });
    this.glide = null;
    await this._facePanel(inf);
  }

  // Standing spot at the back of the car, looking toward the doors with the operating panel (on the front return wall)
  // in view beside them: the whole car reads at once — walls, ceiling light, doors, floor indicator and the keys.
  _panelStand(inf) {
    const L = inf && inf.lift, sd = L && L.stand;
    if (!sd || !L.car) return null;
    L.car.updateMatrixWorld(true);
    const stand = L.car.localToWorld(new THREE.Vector3(sd.x, 0, sd.z));
    const look = new THREE.Vector3(sd.look[0] - sd.x, 0, sd.look[2] - sd.z), dist = look.length();
    look.normalize().transformDirection(L.car.matrixWorld);
    return { x: stand.x, z: stand.z, yaw: yawFromDir(look.x, look.z), pitch: Math.atan2(sd.look[1] - this.player.eye, dist) };
  }
  // Step to the back of the car and turn toward the doors / panel (portrait phones narrow the view a little).
  async _facePanel(inf, dur = 950) {
    const s = this._panelStand(inf);
    this._occupy(inf);
    if (!s) return;
    const P = this.player, fx = P.pos.x, fz = P.pos.z, fy = P.yaw, fp = P.pitch;
    const ty = fy + wrapPi(s.yaw - fy);
    this._zoomForPanel(true, dur);
    await tween(dur, k => { P.pos.x = fx + (s.x - fx) * k; P.pos.z = fz + (s.z - fz) * k; P.yaw = P.tYaw = fy + (ty - fy) * k; P.pitch = P.tPitch = fp + (s.pitch - fp) * k; P.vel.set(0, 0, 0); });
    if (!this._keyHint) { this._keyHint = true; this._toast(this.t('walk.tapKey'), 2600); }
  }
  _occupy(inf) {
    if (this._inCarInf && this._inCarInf !== inf) this._inCarInf.lift.occupied = false;
    this._inCarInf = inf || null;
    if (inf) inf.lift.occupied = true;
  }
  _zoomForPanel(on, dur = 700) {
    if (on) {
      if (this._zoomSaved == null) this._zoomSaved = this._zoomS;
      const a = this.camera.aspect || 1;
      const want = (0.875 * a) / this._baseTanH;             // portrait phones: ≈ 44° across → the car front fills the width, keys finger-sized
      if (want < this._zoomS) this._tweenZoom(want, dur);
    } else if (this._zoomSaved != null) {
      const to = this._zoomSaved; this._zoomSaved = null;
      this._tweenZoom(to, dur);
    }
  }
  _tweenZoom(to, dur) {
    const from = this._zoomS, tok = (this._zoomTok = (this._zoomTok || 0) + 1);
    return tween(dur, k => { if (tok !== this._zoomTok) return; this._zoomS = from + (to - from) * k; this._applyFov(); });
  }

  async _pressLiftButton(floor, act) {
    if (this.riding || this.busy) return;
    let inf = this._carOf(this.player.pos);
    if (!inf) {
      inf = this._infOfAction(act) || this._nearestLift(null, true);
      if (!inf) return;
      this.busy = true;
      try { if (!inf.lift.doorsOpen) await inf.lift.open(); await this._walkIntoCar(inf); } finally { this.busy = false; }
    }
    return this._pressKey(inf, floor);
  }
  // A floor key (3D panel or the 2D fallback grid): light it, click, then ride.
  async _pressKey(inf, floor) {
    if (this.riding || !inf || !liftFloors(inf.bId).includes(floor)) return;   // each tower has its own keypad: −1, 1 … N
    const L = inf.lift;
    this._click();
    if (floor === inf.floor) {
      if (L.press) L.press(floor, 500);
      if (!L.doorsOpen) L.open();
      return;
    }
    if (L.press) L.press(floor);
    return this._ride(inf, floor);
  }
  async _liftDoorKey(act) {
    const inf = this._carOf(this.player.pos) || this._infOfAction(act);
    if (!inf || this.riding) return;
    const L = inf.lift;
    this._click();
    if (L.press) L.press(act.open ? 'open' : 'close', 700);
    try { if (act.open) await L.open(); else await L.close(); } catch (e) { console.warn(e); }
  }
  _liftAlarm(act) {
    const inf = this._carOf(this.player.pos) || this._infOfAction(act);
    this._click(); this._bell();
    if (inf && inf.lift.press) inf.lift.press('bell', 1600);
    this._toast(this.t('walk.alarm'), 2200);
  }

  async _ride(inf, target) {
    if (this.riding || !this.unit) return;
    const from = inf.floor;
    if (target === from) { if (!inf.lift.doorsOpen) inf.lift.open(); return; }
    this.riding = true; this.glide = null; this.root.classList.add('riding');
    this._rideTarget = target; this._renderLiftPanel();
    const P = this.player, bId = inf.bId;
    this._occupy(inf);
    // stand at the panel (the floor screen counts the floors while we travel)
    const st = this._panelStand(inf);
    if (st) {
      const sx = P.pos.x, sz = P.pos.z, sy = P.yaw, sp = P.pitch, ty = sy + wrapPi(st.yaw - sy);
      const far = Math.hypot(st.x - sx, st.z - sz) > 0.05 || Math.abs(ty - sy) > 0.05;
      if (far) { this._zoomForPanel(true, 500); await tween(500, k => { P.pos.x = sx + (st.x - sx) * k; P.pos.z = sz + (st.z - sz) * k; P.yaw = P.tYaw = sy + (ty - sy) * k; P.pitch = P.tPitch = sp + (st.pitch - sp) * k; }); }
    } else {
      const [cx, cz] = this._carWorld(inf), sx = P.pos.x, sz = P.pos.z;
      await tween(350, k => { P.pos.x = sx + (cx - sx) * k; P.pos.z = sz + (cz - sz) * k; });
    }
    // Camera rides a proxy parented like the car: anchor.y follows onTick.
    const anchor = new THREE.Object3D(); anchor.name = 'walk-lift-anchor';
    anchor.position.set(P.pos.x, floorY(bId, from), P.pos.z);
    this.scene.add(anchor); anchor.add(this.camera);
    this.camera.position.set(0, P.eye, 0);
    this._anchor = anchor;
    // Build the destination floor while we travel (its own car is hidden until we arrive).
    const nextP = this._buildCommons(bId, target);
    let absMode = null, lastY = null, lastT = 0, vy = 0;
    this._rideSway = 0; this._rideSpeed = 0;
    const y0 = floorY(bId, from), y1 = floorY(bId, target);
    const onTick = y => {
      if (typeof y !== 'number' || !isFinite(y)) return;
      if (absMode === null && Math.abs(y0) > 0.3) absMode = Math.abs(y - y0) < Math.abs(y);
      const wy = absMode === false ? y0 + y : y;
      anchor.position.y = Math.min(Math.max(wy, Math.min(y0, y1) - 0.5), Math.max(y0, y1) + 0.5);
      this._liftFloorNow = this._floorFromY(anchor.position.y, bId);
      // acceleration feel: the eye lags behind the car (dips when accelerating up, lifts when braking)
      const now = performance.now();
      if (lastY != null && now > lastT) {
        const dt = Math.max(0.008, (now - lastT) / 1000), v = (anchor.position.y - lastY) / dt, acc = (v - vy) / dt;
        vy += (v - vy) * 0.5;
        const want = Math.max(-0.035, Math.min(0.035, -acc * 0.012));
        this._rideSway += (want - this._rideSway) * 0.18;
        this._rideSpeed = Math.abs(vy);
      }
      lastY = anchor.position.y; lastT = now;
    };
    let next;
    try {
      next = await nextP;
      const twin = (next._infos || []).find(i => i.bId === inf.bId && i.core === inf.core && i.doorIndex === inf.doorIndex);
      if (twin && twin.lift.group) twin.lift.group.visible = false;
      if (typeof inf.lift.travelTo === 'function') await inf.lift.travelTo(target, onTick);
      else { const F = liftFloors(bId); await tween(Math.min(6000, Math.max(1800, 1200 * Math.abs(F.indexOf(target) - F.indexOf(from)))), k => onTick(y0 + (y1 - y0) * k)); }
    } catch (e) { console.warn('[walk] lift travel', e); if (!next) next = await nextP.catch(() => null); }
    if (this.disposed) return;
    this._rideSway = 0; this._rideSpeed = 0;
    // Arrive: swap commons, drop the camera back into the world at the same spot of the twin car.
    anchor.remove(this.camera); this.scene.add(this.camera); this.scene.remove(anchor); this._anchor = null;
    P.pos.y = this._targetY = y1;
    let arrived = null;
    if (next) {
      const [lx0, lz0] = worldToLocal(bId, P.pos.x, P.pos.z), offX = lx0 - inf.car[0], offZ = lz0 - inf.car[1];
      this._disposeCommons();
      this._activateCommons(next);
      this.floor = target; this.bId = bId;
      const twin = this.liftInfos.find(i => i.bId === inf.bId && i.core === inf.core && i.doorIndex === inf.doorIndex);
      if (twin) {
        arrived = twin;
        if (twin.lift.group) twin.lift.group.visible = true;
        // same car-relative spot (a shaft may sit a few centimetres differently on another floor plate)
        const [tx, tz] = localToWorldXZ(bId, twin.car[0] + offX, twin.car[1] + offZ); P.pos.x = tx; P.pos.z = tz;
        twin.lift.car.visible = true;
        this._occupy(twin);
        this._syncCamera();
        try { if (!twin.lift.doorsOpen) await twin.lift.open(); } catch (e) { console.warn(e); }
      }
    }
    this._syncCamera();
    this._hideFloorsForWalker(true);
    this.riding = false; this._rideTarget = null; this._liftFloorNow = null;
    this.root.classList.remove('riding');
    this._renderLiftPanel(); this._updateHud(true);
    // turn back toward the open doors, ready to walk out
    if (arrived) {
      const [nx, nz] = dirToWorld(arrived.bId, arrived.n[0], arrived.n[1]);
      const [cx, cz] = this._carWorld(arrived);
      const sx = P.pos.x, sz = P.pos.z, sy = P.yaw, sp = P.pitch, ty = sy + wrapPi(yawFromDir(nx, nz) - sy);
      this._zoomForPanel(false, 800);
      this.busy = true;
      try { await tween(800, k => { P.pos.x = sx + (cx - sx) * k; P.pos.z = sz + (cz - sz) * k; P.yaw = P.tYaw = sy + (ty - sy) * k; P.pitch = P.tPitch = sp * (1 - k); }); }
      finally { this.busy = false; }
    }
  }
  // The stop nearest to a height in a tower's shaft (−1, 1 … N) — what the floor indicator shows during a ride.
  // (data.js floorFromY gives the storey band containing y; a car between two stops reads better with the nearest one.)
  _floorFromY(y, bId = this.bId) {
    const F = liftFloors(bId); if (!F.length) return floorFromY(bId, y);
    let best = F[0], bd = Infinity; for (const f of F) { const d = Math.abs(floorY(bId, f) - y); if (d < bd) { bd = d; best = f; } } return best;
  }

  // ======================= glide =======================
  // Glide target; a closed apartment door on the way shortens it to a comfortable spot ~0.7 m in front of the leaf.
  _glideTo(x, z, direct = false) {
    if (!direct && this._glideViaBalconyDoor(x, z)) return;
    const P = this.player.pos, dx = x - P.x, dz = z - P.z, L = Math.hypot(dx, dz);
    let door = false;
    if (L > 0.3) {
      const dir = new THREE.Vector3(dx / L, 0, dz / L), o = new THREE.Vector3(P.x, P.y + 1.0, P.z);
      const hit = this._cast(this._solidsNear(P, L + 1), o, dir, L + 0.35)[0];
      for (let n = hit && hit.object; n; n = n.parent) { const ud = n.userData || {}; if (ud.doorLeaf || (ud.action && ud.action.type === 'aptDoor')) { door = !ud._open && !ud._anim && !(ud.action && ud.action.part === 'balconyDoor'); break; } }
      if (door) {
        const d = Math.max(0, hit.distance - 0.7);
        if (d < 0.15) { this.glide = null; this._doorHint(true); return; }
        x = P.x + dir.x * d; z = P.z + dir.z * d;
      }
    }
    this.glide = { x, z, t: 0, stuck: 0, door };
  }
  _glideTap(clientX, clientY) {
    if (this.mode === '360' || this.riding) return;
    const hit = this._pickAt(clientX, clientY, true);
    const act = hit && this._actionOf(hit);
    if (act) {
      // double-tap on a balcony door (or on the curtain drawn across it): walk out / in through it
      const bd = this._balconyDoorOf(act, hit);
      if (bd) this._glideThroughDoor(bd.e, bd.d, hit.point);
      return;
    }
    const P = this.player;
    if (hit && hit.object.userData.floor && hit.distance < 35 && Math.abs(hit.point.y - P.pos.y) < 1.5) return this._glideTo(hit.point.x, hit.point.z);
    if (hit && !hit.object.userData.floor && hit.distance < 35) { // clicked a wall/furniture → go to its foot
      const d = new THREE.Vector3(hit.point.x - P.pos.x, 0, hit.point.z - P.pos.z); const L = d.length();
      if (L > 0.6) { d.multiplyScalar((L - 0.5) / L); return this._glideTo(P.pos.x + d.x, P.pos.z + d.z); }
    }
    this._glideTo(P.pos.x - Math.sin(P.yaw) * 2.5, P.pos.z - Math.cos(P.yaw) * 2.5);
  }

  // ======================= concierge (ground-floor reception, commons.concierges) =======================
  // She follows the visitor with her head inside 6 m, waves/nods at ~4.5 m and offers help at ~3 m (or on tap).
  _conciergeTick(dt) {
    const list = this.commons && this.commons.concierges;
    if (!list || !list.length) { if (this._cgOpen) this._cgClose(); return; }
    const eye = this.camera.getWorldPosition(this._cgEye || (this._cgEye = new THREE.Vector3()));
    const away = this.riding || this.drive || this.mode === '360';
    for (const cg of list) {
      let d;
      try { d = cg.update(dt, away ? null : eye); } catch (e) { if (!this._cgErr) { this._cgErr = true; console.warn('[walk] concierge', e); } continue; }
      if (away || this.busy) continue;
      if (d < 4.5 && !cg._greeted) { cg._greeted = true; cg.greet(); }
      else if (d > 6.5) cg._greeted = false;
      if (d < 3 && !cg._near) { cg._near = true; if (!this._cgOpen) this._cgShow(cg, { auto: true }); }
      else if (d > 4.2 && cg._near) { cg._near = false; if (this._cgOpen && this._cgCur === cg) this._cgClose(); }
    }
  }
  _cgShow(cg, { auto = false, stair = null } = {}) {
    if (!this.el) return;
    if (this._icOpen) this._icClose();
    this._cgStair = stair ?? cg.stair;   // the lifts she sends you to (called from an entrance intercom: that staircase)
    if (!this.el.cg) {
      const d = document.createElement('div'); d.className = 'vw-cg vw-panel'; d.setAttribute('role', 'dialog');
      d.innerHTML = `<div class="hd"><span class="av" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e6c987" stroke-width="1.3" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M15.2 5.6c1.3.2 2.2 1.2 2 2.4"/><path d="M5 20c.6-4 3.4-6.2 7-6.2s6.4 2.2 7 6.2"/><path d="M10 14.2 12 17l2-2.8"/></svg></span>
        <div class="who"><b></b><span></span></div><button class="ib vo" data-cg="voice" aria-pressed="false"></button><button class="ib" data-cg="close">✕</button></div>
        <p class="msg" aria-live="polite"></p><div class="acts"></div>`;
      this.el.hud.appendChild(d); this.el.cg = d;
      this._cgVoice = lsGet('vrc.walk.voice') === '1';
    }
    this._cgCur = cg; this._cgAuto = auto; this._cgOpen = true;
    this._cgRender('main');
    this.el.cg.classList.add('show');
    if (!auto) cg.greet();
    const ua = typeof navigator !== 'undefined' && navigator.userActivation;
    if (this._cgVoice && (!auto || !ua || ua.hasBeenActive)) this._cgSpeak(this.t('walk.cg.hello'));
  }
  _cgClose() {
    this._cgOpen = false;
    if (this.el && this.el.cg) this.el.cg.classList.remove('show');
    try { if (this._cgSpoke && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* optional */ }
  }
  _cgRender(view = 'main') {
    const d = this.el && this.el.cg; if (!d) return;
    this._cgView = view;
    const t = k => this.t('walk.cg.' + k), esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    d.dir = this.dir; d.lang = this.lang;
    d.setAttribute('aria-label', t('role'));
    d.querySelector('.who b').textContent = t('name');
    d.querySelector('.who span').textContent = t('role');
    const vo = d.querySelector('.vo');
    vo.innerHTML = this._cgVoice
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
    vo.classList.toggle('on', !!this._cgVoice); vo.setAttribute('aria-pressed', String(!!this._cgVoice));
    vo.title = t('voice'); vo.setAttribute('aria-label', t('voice'));
    const x = d.querySelector('[data-cg=close]'); x.title = t('close'); x.setAttribute('aria-label', t('close'));
    const msg = d.querySelector('.msg'), acts = d.querySelector('.acts');
    const u = this.unit;
    if (view === 'floors') {
      msg.textContent = t('pickFloor');
      acts.className = 'acts fl';
      const fl = liftFloors(this.bId), mine = u && u.building === this.bId ? u.floor : null;
      acts.style.gridTemplateColumns = fl.length > 12 ? 'repeat(6,1fr)' : '';
      acts.innerHTML = fl.map(f => `<button data-cg="f" data-f="${f}" class="${f === this.floor ? 'here' : ''}${f === mine ? ' mine' : ''}"${f === this.floor ? ' aria-current="true"' : ''}>${esc(floorLabel(f))}</button>`).join('')
        + `<button class="wide" data-cg="back">${esc(t('back'))}</button>`;
      return;
    }
    msg.textContent = t('hello');
    acts.className = 'acts'; acts.style.gridTemplateColumns = '';
    const fName = u ? this._floorName(u.floor) : '';
    acts.innerHTML = `
      <button class="pri" data-cg="apt"><i>⌂</i><span>${esc(t('myApt'))}${u ? `<small>${esc(fName)} · ${esc(u.apNo ?? '')}</small>` : ''}</span></button>
      <button data-cg="floors"><i>⇅</i><span>${esc(t('floors'))}</span></button>
      <button data-cg="park"><i>P</i><span>${esc(t('parking'))}</span></button>
      <button data-cg="model"><i>◇</i><span>${esc(t('model'))}</span></button>
      <button data-cg="book" style="grid-column:1/-1"><i>✦</i><span>${esc(t('book'))}</span></button>
      <button class="wide" data-cg="close">${esc(t('close'))}</button>`;
  }
  async _cgAction(k, b) {
    this._click && this._click(0.3);
    if (k === 'close') return this._cgClose();
    if (k === 'back') return this._cgRender('main');
    if (k === 'floors') return this._cgRender('floors');
    if (k === 'voice') {
      this._cgVoice = !this._cgVoice; lsSet('vrc.walk.voice', this._cgVoice ? '1' : '0');
      this._cgRender(this._cgView);
      if (this._cgVoice) this._cgSpeak(this.el.cg.querySelector('.msg').textContent);
      else try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* optional */ }
      return;
    }
    if (k === 'f') { const f = +b.dataset.f; if (f === this.floor || !liftFloors(this.bId).includes(f)) return; this._cgClose(); return this._cgRide(f); }
    this._cgClose();
    if (k === 'apt') return this._cgGoApt();
    if (k === 'park') return this._cgRide(-1);
    if (k === 'model') return this._goto('apartment');
    if (k === 'book') return this._cgBook();
  }
  // Take the lift by the reception to another floor: call it, step in, press the key, ride.
  async _cgRide(floor) {
    if (this.riding || this.busy || !this.unit) return false;
    if (floor === this.floor) return true;
    this._toast(this.t('walk.cg.going'), 2200);
    const stair = this._cgStair ?? (this._cgCur ? this._cgCur.stair : null);
    if (stair != null && this._isOutside()) await this._walkIn(this.bId, stair);   // called from the entrance intercom
    await this._callLift(stair, this.bId);
    const inf = this._carOf(this.player.pos);
    if (!inf) return false;
    await this._pressKey(inf, floor);
    return this.floor === floor;
  }
  async _cgGoApt() {
    const u = this.unit; if (!u) return;
    // the lobby's lifts serve this tower only: a flat in another tower is reached by the jump itself
    if (u.building === this.bId && u.floor !== this.floor && !(await this._cgRide(u.floor))) return;
    await this._goto('corridor');   // the walk from the lift to the door, then stand before it
  }
  _cgBook() {
    const id = this.unit && this.unit.id, V = typeof window !== 'undefined' ? window.VRC : null;
    if (V && typeof V.openBooking === 'function') { try { V.openBooking(id); return; } catch (e) { console.warn('[walk] openBooking', e); } }
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'vrc:navigate', hash: '#contact', unitId: id }, '*');
        try { window.parent.location.hash = 'contact'; } catch { /* cross-origin parent: the message does it */ }
        return;
      }
    } catch { /* no parent access */ }
    this.opts.onExit && this.opts.onExit();
    setTimeout(() => {
      const el = document.getElementById('contact') || document.querySelector('.foot-contact');
      try { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else location.hash = 'contact'; } catch { /* optional */ }
    }, 60);
  }
  _cgSpeak(text) {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined' || !text) return;
    try {
      const l2 = String(this.lang).slice(0, 2).toLowerCase();
      const LC = { he: 'he-IL', en: 'en-GB', ro: 'ro-RO', ru: 'ru-RU', uk: 'uk-UA', fr: 'fr-FR', it: 'it-IT', de: 'de-DE' };
      speechSynthesis.cancel();
      const ut = new SpeechSynthesisUtterance(text);
      ut.lang = LC[l2] || 'en-GB'; ut.rate = 0.97; ut.pitch = 1.05;
      const vs = (speechSynthesis.getVoices && speechSynthesis.getVoices()) || [];
      const cand = vs.filter(v => String(v.lang || '').toLowerCase().replace('_', '-').startsWith(l2));
      const v = cand.find(v => /female|woman|samantha|victoria|karen|moira|tessa|serena|carmit|zira|hedda|katja|anna|alice|amelie|aurelie|milena|ioana|lesya|paulina/i.test(v.name)) || cand[0];
      if (v) ut.voice = v;
      speechSynthesis.speak(ut); this._cgSpoke = true;
    } catch (e) { console.warn('[walk] speech', e); }
  }
  // The walker crossed into an apartment (past its entrance door line): tell the page and draw the curtains open.
  _aptEnterWatch() {
    if (this.riding || !this.loaded.size) return;
    const e = this._aptAt(this.player.pos), id = e ? e.unit.id : null;
    if (id === this._inAptId) return;
    this._inAptId = id;
    if (!e) return;
    try { if (e.apt && typeof e.apt.openCurtains === 'function') e.apt.openCurtains(); } catch (err) { console.warn('[walk] openCurtains', err); }
    try { window.dispatchEvent(new CustomEvent('vrc:apt-enter', { detail: { unitId: id } })); } catch (err) { console.warn('[walk] vrc:apt-enter', err); }
  }

  // ======================= frame loop =======================
  _loop() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(this._loop);
    if (this._paused || this._pano || this._photoPaused) return;   // hidden tab, or a photoreal tour owns the screen
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this._ghosts && this._ghosts.length) this._reconcileGhosts();
    this._update(dt);
    if (this.apt && this.apt.game) this.apt.game.frame(this, dt);   // snooker table (snooker.js): "Play" prompt; in play mode it owns the camera (walking is held by this.busy)
    try { this.env && this.env.update && this.env.update(dt, this.camera); } catch (e) { if (!this._envErr) { console.warn(e); this._envErr = true; } }
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    const P = this.player;
    if (this.drive) {
      if (!this.busy) this._driveUpdate(dt);
      this._autoDoors(dt); this._outdoorWatch(); this._cullWorld();
      if (this._expT) { const r = this.renderer; r.toneMappingExposure += (this._expT - r.toneMappingExposure) * damp(2.5, dt); }
      const now = performance.now();
      if (now - this._lastHud > 200) { this._lastHud = now; this._updateHud(); }
      if (now - this._lastMap > 110) { this._lastMap = now; this._drawMap(); }
      return;
    }
    // look
    let turn = 0;
    if (this.keys.has('ArrowLeft') || this.pad.l) turn += 1;
    if (this.keys.has('ArrowRight') || this.pad.r) turn -= 1;
    if (turn) { P.tYaw += turn * 1.5 * dt; this.touched360 = true; }
    if (this.mode === '360' && !this.touched360 && !this._dragging) P.tYaw += 0.09 * dt;
    P.yaw += (P.tYaw - P.yaw) * damp(14, dt);
    P.pitch += (P.tPitch - P.pitch) * damp(14, dt);

    if (!this.riding && !this.busy && this.mode === 'walk' && this.apt) {
      let f = 0, s = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.pad.u) f += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.pad.d) f -= 1;
      if (this.keys.has('KeyD')) s += 1;
      if (this.keys.has('KeyA')) s -= 1;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      const want = new THREE.Vector3();
      if (f || s) {
        this.glide = null;
        const sp = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? RUN : SPEED;
        want.set(fx * f + rx * s, 0, fz * f + rz * s).normalize().multiplyScalar(sp);
      } else if (this.glide) {
        const g = this.glide, dx = g.x - P.pos.x, dz = g.z - P.pos.z, L = Math.hypot(dx, dz);
        g.t += dt;
        if ((L < 0.12 || (g.next && g.next.length && L < 0.3)) && g.next && g.next.length) { const n = g.next.shift(); g.x = n[0]; g.z = n[1]; g.stuck = 0; }
        else if (L < 0.12 || g.t > 12) { this.glide = null; if (g.door) this._doorHint(true); }
        else want.set(dx / L, 0, dz / L).multiplyScalar(Math.min(1.9, (g.next && g.next.length ? 1.2 : 0) + L * 1.8 + 0.25) * Math.min(1, 0.35 + g.t * 2.2));
      }
      P.vel.lerp(want, damp(want.lengthSq() ? 7 : 10, dt));
      if (P.vel.lengthSq() > 1e-6) {
        const d = P.vel.clone().multiplyScalar(dt), exp = d.length();
        const got = this._move(d);
        if (this.glide) { if (got < exp * 0.3) { this.glide.stuck += dt; if (this.glide.stuck > 0.35) { this.glide = null; this._doorHint(); } } else this.glide.stuck = 0; }
        else if (f > 0 && got < exp * 0.2) this._doorHint();
        if (got < exp * 0.2 && !f && !s) P.vel.multiplyScalar(0.5);
      }
      // stairs / steps: follow the floor under us
      if (this._targetY != null) {
        const fy = this._floorAt(P.pos.x, P.pos.y, P.pos.z, this._near(this.floors, P.pos, 1.2));
        if (fy !== null) this._targetY = fy;
        P.pos.y += (this._targetY - P.pos.y) * damp(12, dt);
      }
      this._autoDoor(f > 0);
      this._carWatch();
      this._carChipWatch();
      this._outdoorWatch();
    }
    this._autoDoors(dt);
    this._balconyDoorsTick(dt);
    this._syncCamera();
    this._conciergeTick(dt);
    this._intercomTick();
    this._aptEnterWatch();
    this._cullWorld();
    if (this.fleet) this.fleet.update(this.camera);
    if (this._expT) { const r = this.renderer; r.toneMappingExposure += (this._expT - r.toneMappingExposure) * damp(2.5, dt); }

    const now = performance.now();
    if (now - this._lastHud > 200) { this._lastHud = now; this._updateHud(); }
    if (now - this._lastMap > 110) { this._lastMap = now; this._drawMap(); }
    this._updateDim(now);
  }

  _syncCamera() {
    const P = this.player, cam = this.camera;
    if (this._anchor) cam.position.set(P.pos.x - this._anchor.position.x, P.eye, P.pos.z - this._anchor.position.z);
    else cam.position.set(P.pos.x, P.pos.y + P.eye, P.pos.z);
    if (this._anchor) {   // riding: eye lag from the car's acceleration + a whisper of sway at speed
      const t = performance.now() / 1000, sp = Math.min(1, (this._rideSpeed || 0) / 2.5);
      cam.position.y += this._rideSway || 0;
      cam.rotation.set(P.pitch + Math.sin(t * 1.7) * 0.0025 * sp, P.yaw, Math.sin(t * 2.3) * 0.004 * sp, 'YXZ');
    } else cam.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
    this._syncEnvMap();
  }
  // Interior IBL indoors, sky IBL outdoors (balcony, street) for correct glass/metal reflections.
  _syncEnvMap() {
    const cur = this.scene.environment;
    if (cur && cur !== this.roomEnv) this.skyEnv = cur;
    const outside = this._placeKind === 'outdoor';
    const want = (!outside && this.roomEnv) ? this.roomEnv : this.skyEnv;
    if (want && cur !== want) this.scene.environment = want;
  }

  // Loaded apartments' doors open by themselves when you WALK into them (pad/keys); a glide stops at a closed door.
  _autoDoor(walking) {
    if (!walking || !this.loaded.size) return;
    const P = this.player.pos;
    if (this.player.vel.lengthSq() < 0.05) return;
    for (const e of this.loaded.values()) {
      const leaf = e.apt.doorLeaf;
      if (!leaf || leaf.userData._open || leaf.userData._anim || leaf.userData._autoDone) continue;
      const [x, z] = unitToWorld(e.unit, (e.apt.entrance && e.apt.entrance.u) ?? e.unit.door.u, 0);
      if (Math.abs(P.y - floorY(e.unit.building, e.unit.floor)) > 1 || Math.hypot(P.x - x, P.z - z) > 1.5) continue;
      leaf.userData._autoDone = true; this._toggleDoor(leaf, true);
    }
  }
  // ---- balcony / loggia / terrace doors (apt.balconyDoors): open on approach from either side, close behind you ----
  // Per-door walker state: auto = opened by proximity (so it may close again by itself; a door opened by a tap or by
  // starting on the balcony stays open until tapped), far = seconds spent away, hold = the user just tapped it shut →
  // no auto-opening until they step back (otherwise it would re-open in their face).
  _bdS(d) {
    const m = this._bdState || (this._bdState = new WeakMap());
    let s = m.get(d); if (!s) m.set(d, s = { auto: false, far: 0, hold: false });
    return s;
  }
  // Curtains drawn across a door open with it (level + room match; else the curtain whose centre is nearest in u).
  _bdCurtains(e, d, instant = false) {
    for (const c of this._bdCur(e, d)) if (!c.open && typeof c.toggle === 'function') { try { c.toggle(true, { instant }); } catch (err) { console.warn('[walk] curtain', err); } }
  }
  _bdCur(e, d) {
    const s = this._bdS(d);
    if (!s.cur) {
      const cs = (e.apt.curtains || []).filter(c => c.level === d.level && Math.abs((c.v ?? d.v) - d.v) < 0.9);
      s.cur = cs.filter(c => c.roomName === d.roomName);
      if (!s.cur.length && cs.length) s.cur = [cs.reduce((a, c) => Math.abs(c.u - d.u) < Math.abs(a.u - d.u) ? c : a)];
    }
    return s.cur;
  }
  // Walker position (or any world point) in an apartment's unit-local frame: x = u, y above its floor, z = v.
  _bdLocal(e, pos, out) { return e.apt.group.worldToLocal((out || new THREE.Vector3()).copy(pos)); }
  _bdDist(d, lp) {
    if (Math.abs(lp.y - d.y) > 1.3) return Infinity;
    const cu = Math.max(d.p0, Math.min(d.p1, lp.x));
    return Math.hypot(cu - lp.x, d.v - lp.z);
  }
  _bdOpen(e, d, auto, instant = false) {
    const s = this._bdS(d);
    if (!d.open) { try { d.toggle(true, { instant }); } catch (err) { console.warn('[walk] balcony door', err); return; } s.auto = auto; }
    else if (!auto) s.auto = false;
    s.far = 0; s.hold = false;
    this._bdCurtains(e, d, instant);
  }
  _balconyDoorsTick(dt) {
    if (!this.loaded.size || this.riding || this.drive) return;
    const P = this.player, walk = this.mode === 'walk';
    const lp = this._bdV || (this._bdV = new THREE.Vector3()), q = this._bdQ || (this._bdQ = new THREE.Quaternion());
    const fw = this._bdF || (this._bdF = new THREE.Vector3()), vl = this._bdW || (this._bdW = new THREE.Vector3());
    for (const e of this.loaded.values()) {
      const doors = e.apt.balconyDoors;
      if (!doors || !doors.length || !e.apt.group) continue;
      this._bdLocal(e, P.pos, lp);
      // forward / velocity / glide heading in unit-local (the apartment group is only rotated about y)
      q.copy(e.apt.group.quaternion).invert();
      fw.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)).applyQuaternion(q);
      vl.copy(P.vel); if (this.glide) vl.set(this.glide.x - P.pos.x, 0, this.glide.z - P.pos.z).normalize().multiplyScalar(1.2);
      vl.applyQuaternion(q);
      for (const d of doors) {
        if (typeof d.toggle !== 'function') continue;
        const s = this._bdS(d), dist = this._bdDist(d, lp);
        if (s.hold && dist > BD_REARM_R) s.hold = false;
        if (!d.open) s.auto = false;
        if (!d.open || (dist < BD_OPEN_R && this._bdCur(e, d).some(c => !c.open))) {
          if (!walk || s.hold || dist > BD_HINT_R) continue;
          let toward = dist < 0.35;
          if (!toward) {
            const cu = Math.max(d.p0, Math.min(d.p1, lp.x)), nx = (cu - lp.x) / dist, nz = (d.v - lp.z) / dist;
            toward = fw.x * nx + fw.z * nz > 0.3 || vl.x * nx + vl.z * nz > 0.25;
          }
          if (!toward) continue;
          if (d.open) { this._bdCurtains(e, d); continue; }      // open door behind a drawn curtain: draw it back
          if (!this._bdHinted) { this._bdHinted = true; this._toast(this.t('walk.balconyDoorHint'), 3600); }
          if (dist < BD_OPEN_R) { this._bdOpen(e, d, true); this._click?.(0.25); }
        } else if (s.auto) {
          if (dist > BD_CLOSE_R) { s.far += dt; if (s.far > BD_CLOSE_S) { s.auto = false; s.far = 0; try { d.toggle(false); } catch (err) { console.warn('[walk] balcony door', err); } } }
          else s.far = 0;
        }
      }
    }
  }
  // Which balcony door does a picked action belong to? (its collider / a leaf, or a curtain hanging right in front of one)
  _balconyDoorOf(a, hit) {
    const act = a && a.action; if (!act || act.type !== 'aptDoor') return null;
    const e = this.loaded.get(act.unitId); if (!e || !e.apt.balconyDoors) return null;
    if (act.part === 'balconyDoor') { const d = e.apt.balconyDoors.find(x => x.id === act.door); return d ? { e, d } : null; }
    if (!act.curtain || act.part === 'curtainSwitch' || !hit) return null;
    const lp = this._bdLocal(e, hit.point);
    const d = e.apt.balconyDoors.find(x => Math.abs(lp.y - x.y - 1.2) < 1.6 && lp.x > x.p0 - 0.7 && lp.x < x.p1 + 0.7 && Math.abs(lp.z - x.v) < 0.6);
    return d ? { e, d } : null;
  }
  // Tap on a leaf / the glass / the handle, from the room or from the balcony: toggle. A door the user opened stays open.
  _tapBalconyDoor(a) {
    const bd = this._balconyDoorOf(a, a.hit);
    this._click?.(0.35);
    if (!bd) return this._toggleDoor(a.obj);
    const { e, d } = bd, s = this._bdS(d);
    if (d.open) { s.auto = false; s.far = 0; s.hold = true; return d.toggle(false); }
    this._bdOpen(e, d, false);
  }
  // Teleported onto the balcony / terrace (start=balcony, room chips): the nearest door of that level is open.
  _openBalconyDoorAt(pos) {
    const e = this._aptAt(pos) || (this.unit && this.loaded.get(this.unit.id));
    if (!e || !e.apt.balconyDoors || !e.apt.balconyDoors.length) return;
    const lp = this._bdLocal(e, pos);
    let best = null, bd = Infinity;
    for (const d of e.apt.balconyDoors) { if (typeof d.toggle !== 'function') continue; const k = this._bdDist(d, lp); if (k < bd) { bd = k; best = d; } }
    if (best) this._bdOpen(e, best, false, true);
    else if (typeof e.apt.openBalconyDoor === 'function') { try { e.apt.openBalconyDoor(0); } catch (err) { console.warn('[walk] balcony door', err); } }
  }
  // Glide through door d of apartment e towards the other side (hit = world point tapped on the door).
  _glideThroughDoor(e, d, hit) {
    const lp = this._bdLocal(e, this.player.pos), side = lp.z < d.v ? 1 : -1;
    const hu = hit ? this._bdLocal(e, hit).x : lp.x, m = Math.min(0.42, (d.p1 - d.p0) / 2 - 0.05);
    const cu = Math.max(d.p0 + m, Math.min(d.p1 - m, hu));
    this._bdOpen(e, d, !d.open ? true : this._bdS(d).auto);
    const w = (u, v) => { const p = e.apt.group.localToWorld(new THREE.Vector3(u, d.y, v)); return [p.x, p.z]; };
    const pts = [];
    if (Math.abs(lp.z - d.v) > 0.6 && Math.abs(lp.x - cu) > 0.2) pts.push(w(cu, d.v - side * 0.5));
    pts.push(w(cu, d.v + side * 0.85));
    this.glide = { x: pts[0][0], z: pts[0][1], t: 0, stuck: 0, door: false, next: pts.slice(1) };
  }
  // A glide whose target lies across the glazing line (room → balcony or back) is routed through the best door
  // of that level, which opens on the way. Returns true when it took the glide over.
  _glideViaBalconyDoor(x, z) {
    const P = this.player.pos;
    const e = this._aptAt(P); if (!e || !e.apt.balconyDoors || !e.apt.balconyDoors.length) return false;
    const lp = this._bdLocal(e, P), lt = this._bdLocal(e, new THREE.Vector3(x, P.y, z));
    let best = null, cost = Infinity, bu = 0;
    for (const d of e.apt.balconyDoors) {
      if (typeof d.toggle !== 'function' || Math.abs(lp.y - d.y) > 1.3) continue;
      if ((lp.z - d.v) * (lt.z - d.v) >= 0) continue;                       // same side: no door involved
      const k = (d.v - lp.z) / (lt.z - lp.z), iu = lp.x + (lt.x - lp.x) * k, m = Math.min(0.42, (d.p1 - d.p0) / 2 - 0.05);
      const cu = Math.max(d.p0 + m, Math.min(d.p1 - m, iu));
      const c = Math.hypot(cu - lp.x, d.v - lp.z) + Math.hypot(lt.x - cu, lt.z - d.v);
      if (c < cost) { cost = c; best = d; bu = cu; }
    }
    if (!best) return false;
    const d = best, side = lp.z < d.v ? 1 : -1;
    this._bdOpen(e, d, !d.open ? true : this._bdS(d).auto);
    const w = (u, v) => { const p = e.apt.group.localToWorld(new THREE.Vector3(u, d.y, v)); return [p.x, p.z]; };
    const pts = [];
    if (Math.abs(lp.z - d.v) > 0.6) pts.push(w(bu, d.v - side * 0.5));
    pts.push(w(bu, d.v + side * 0.5));
    if (Math.abs(lt.z - d.v) > 0.55) pts.push([x, z]);
    this.glide = { x: pts[0][0], z: pts[0][1], t: 0, stuck: 0, door: false, next: pts.slice(1) };
    return true;
  }
  // Blocked by a closed apartment door → tell the user to tap it (throttled).
  _doorHint(known = false) {
    const now = performance.now(); if (now - (this._doorHintT || 0) < 5000) return;
    if (known) { this._doorHintT = now; this._toast(this.t('walk.tapDoor'), 2400); return; }
    const P = this.player, dir = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    const o = new THREE.Vector3(P.pos.x, P.pos.y + 1.0, P.pos.z);
    const hit = this._cast(this._solidsNear(P.pos, 1.6), o, dir, 1.1)[0];
    if (!hit) return;
    let x = hit.object, door = false;
    while (x) { const ud = x.userData || {}; if (ud.doorLeaf || (ud.action && ud.action.type === 'aptDoor')) { door = true; break; } x = x.parent; }
    if (!door) return;
    this._doorHintT = now; this._toast(this.t('walk.tapDoor'), 2400);
  }
  // Entering the car on foot → turn to the panel; leaving it → restore the view and free the car.
  _carWatch() {
    if (this.busy || this.riding) return;
    const inf = this._carOf(this.player.pos);
    if (inf && inf !== this._inCarInf) {
      this._occupy(inf);
      this.busy = true; this.glide = null; this.player.vel.set(0, 0, 0);
      this._facePanel(inf, 900).finally(() => { this.busy = false; });
      this._renderLiftPanel();
    } else if (!inf && this._inCarInf) {
      this._occupy(null);
      this._zoomForPanel(false, 600);
      this._renderLiftPanel();
    }
  }

  // ======================= where am I =======================
  _unitUV(pos) {
    if (!this.unit || this.bId !== this.unit.building) return null;
    const [lx, lz] = worldToLocal(this.unit.building, pos.x, pos.z);
    const [u, v] = localToUnit(this.unit, lx, lz);
    const dy = pos.y - floorY(this.unit.building, this.unit.floor);
    if (dy < -0.6 || dy > 1.6) return null;          // another storey (every flat is on one level)
    return { u, v, level: 0 };
  }
  _currentRoom() {
    const uv = this._unitUV(this.player.pos);
    if (!uv || !this.rooms) return null;
    const cur = this.loaded.get(this.unit.id), B = cur ? this._aptBox(cur) : { u0: 0, u1: this.unit.width, v1: this.unit.depth };
    if (uv.u < B.u0 - 0.05 || uv.u > B.u1 + 0.05 || uv.v < 0.02 || uv.v > B.v1 + 0.6) return null;
    const cand = this.rooms;
    const hit = cand.find(r => r.poly && pointInPoly([uv.u, uv.v], r.poly));
    if (hit) return hit;
    if (uv.v > this.unit.depth || uv.u < 0 || uv.u > this.unit.width) return cand.find(r => OUTDOOR.has(r.kind)) || null;
    let best = null, bd = Infinity;
    for (const r of cand) { const d = Math.hypot(r.center[0] - uv.u, r.center[1] - uv.v); if (d < bd) { bd = d; best = r; } }
    return best;
  }
  _placeTitle(room, inf, outside, fl) {
    if (room || this.drive || outside || this.floor == null) return null;   // in the apartment / outdoors → the unit title
    const bId = (inf && inf.bId) || this.bId || (this.unit && this.unit.building);
    const f = this.riding ? (this._liftFloorNow ?? this.floor) : this.floor;
    const parts = [this._bName(bId), this._floorName(f)];
    if (this.riding || inf) parts.push(this.t('walk.lift'));
    else if (f !== -1) parts.push(this.t(isGround(f) ? 'walk.lobby' : 'walk.corridor'));
    return parts.filter(Boolean).join(' · ');
  }
  // "Будинок 1" — the tower's display number (BUILDINGS[b].no), never its internal id
  _bName(bId) { const b = BUILDINGS[bId]; return `${this.t('ul.building')} ${b ? b.no : bId}`; }
  // "Поверх 5" (floor 1 is the ground floor) · "Паркінг −1"
  _floorName(f) {
    if (f === -1) return `${this.t('walk.parking')} ${floorLabel(-1)}`;
    return `${this.t('walk.floor')} ${floorLabel(f)}`;
  }

  // ======================= HUD =======================
  _buildHud() {
    const h = document.createElement('div'); h.className = 'vw-hud';
    h.innerHTML = `
      <div class="vw-top">
        <div class="vw-title vw-panel"><div class="t1"></div><div class="t2"></div></div>
        <div class="vw-actions">
          <button class="vw-btn vw-ghost vw-icon vw-helpbtn" data-k="help" aria-label="help">?</button>
          <button class="vw-btn vw-ghost vw-photo" data-k="photo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg><span class="lbl"></span></button>
          <button class="vw-btn vw-gold" data-k="reserve"><span class="lbl"></span><span class="vw-price"></span></button>
          <button class="vw-btn vw-ghost vw-icon vw-gear" data-k="gear" aria-expanded="false">${ICON_GEAR}</button>
          <button class="vw-btn vw-ghost vw-exit" data-k="exit"><span aria-hidden="true">✕</span><span class="lbl"></span></button>
        </div>
      </div>
      <div class="vw-tools vw-panel col">
        <div class="vw-seg" data-k="mode"><button data-m="walk"></button><button data-m="360"></button></div>
        <div class="vw-seg vw-time" data-k="time"><button data-t="day" title="">☀\uFE0E</button><button data-t="dusk">◐</button><button data-t="night">☾</button></div>
        <div class="vw-seg vw-zoom" data-k="zoom"><button data-z="-1">−</button><span class="zv"></span><button data-z="1">+</button></div>
        <button class="vw-tlabel st" data-k="dlabel"></button>
        <div class="vw-styles"></div>
        <button class="vw-tlabel st" data-k="flabel"></button>
        <div class="vw-styles vw-finish"></div>
        <button class="vw-prow" data-k="help"><i>?</i><span></span></button>
      </div>
      <div class="vw-map vw-panel"><canvas></canvas></div>
      <button class="vw-mapbtn vw-panel" data-k="map">${ICON_MAP}</button>
      <div class="vw-lift vw-panel"><div class="hd"><span class="lt"></span><span class="ind"></span></div><div class="grid"></div></div>
      <button class="vw-floorsbtn vw-ghost" data-k="floors" aria-expanded="false"><span aria-hidden="true">⇅</span><span class="lbl"></span></button>
      <div class="vw-pad">
        <button class="u" data-p="u" aria-label="forward">▲</button><button class="l" data-p="l" aria-label="turn left">◀</button>
        <button class="r" data-p="r" aria-label="turn right">▶</button><button class="d" data-p="d" aria-label="back">▼</button>
      </div>
      <div class="vw-bottom"><div class="vw-row vw-rooms"></div><div class="vw-row vw-tp"></div></div>
      <div class="vw-modes vw-panel" role="group"><button data-vm="3d" aria-pressed="true"></button><button data-vm="real" aria-pressed="false"></button><span class="soon" role="status"></span></div>
      <div class="vw-ucard vw-panel"><div class="ut"><div class="u1"></div><div class="u2"></div></div><button class="vw-btn vw-gold" data-k="ureserve"></button></div>
      <button class="vw-carchip vw-btn vw-gold" data-k="carenter"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3.5 15.5v-3l2.2-4.6A2 2 0 0 1 7.5 6.8h9a2 2 0 0 1 1.8 1.1l2.2 4.6v3"/><path d="M2.8 15.5h18.4v2.4H2.8z"/><circle cx="7" cy="18.3" r="1.6"/><circle cx="17" cy="18.3" r="1.6"/><path d="M5.2 12.3h13.6"/></svg><span class="lbl"></span></button>
      <div class="vw-drive">
        <div class="vw-dtop"><button class="vw-btn vw-ghost vw-ico" data-k="carlights"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 5.5C8 5.5 6 8.6 6 12s2 6.5 6.5 6.5c1.6 0 2.5-2.9 2.5-6.5s-.9-6.5-2.5-6.5z"/><path d="M17.5 8h4M17.5 12h4M17.5 16h4"/></svg></button><button class="vw-btn vw-ghost vw-ico" data-k="carsound"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path class="on" d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10"/><path class="off" d="M16 9.5l5 5M21 9.5l-5 5"/></svg></button><button class="vw-btn vw-ghost" data-k="carview"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><span class="lbl"></span></button><button class="vw-btn vw-gold" data-k="carexit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3.5 15.5v-3l2.2-4.6A2 2 0 0 1 7.5 6.8h9a2 2 0 0 1 1.8 1.1l2.2 4.6v3"/><path d="M2.8 15.5h18.4v2.4H2.8z"/><circle cx="7" cy="18.3" r="1.6"/><circle cx="17" cy="18.3" r="1.6"/><path d="M5.2 12.3h13.6"/></svg><span class="lbl"></span></button></div>
        <div class="vw-spdo"><svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="vwgold" x1="0" x2="1"><stop offset="0" stop-color="#b88a3c"/><stop offset="1" stop-color="#f0d596"/></linearGradient></defs><circle class="bg" cx="50" cy="50" r="30"/><circle class="arc" cx="50" cy="50" r="30"/></svg><div class="num"><b class="spd">0</b><i>km/h</i></div><span class="gear">P</span><span class="lim" role="img"></span></div>
        <div class="vw-steer" data-pd="steer"><span class="l" aria-hidden="true">◀</span><span class="knob"></span><span class="r" aria-hidden="true">▶</span></div>
        <div class="vw-pedals"><button class="brake" data-pd="brake"><i></i><span></span></button><button class="gas" data-pd="gas"><i></i><span></span></button></div>
        <div class="vw-dhint vw-panel"></div>
      </div>
      <div class="vw-toast vw-panel"></div>
      <div class="vw-fade"></div>
      <div class="vw-help"><div class="card"><h3></h3><ul></ul><button class="vw-btn vw-gold" data-k="helpok"></button></div></div>
      <div class="vw-loading"><div class="ring"></div><div class="lt"></div></div>`;
    this.root.appendChild(h);
    const q = s => h.querySelector(s);
    this.el = {
      hud: h, t1: q('.t1'), t2: q('.t2'), reserve: q('[data-k=reserve]'), photo: q('[data-k=photo]'), exit: q('[data-k=exit]'), helpBtn: q('[data-k=help]'),
      tools: q('.vw-tools'), modeSeg: q('[data-k=mode]'), timeSeg: q('[data-k=time]'), dlabel: q('[data-k=dlabel]'), styles: q('.vw-styles'), flabel: q('[data-k=flabel]'), finish: q('.vw-finish'),
      map: q('.vw-map canvas'), lift: q('.vw-lift'), liftGrid: q('.vw-lift .grid'), liftT: q('.vw-lift .lt'), liftInd: q('.vw-lift .ind'),
      pad: q('.vw-pad'), rooms: q('.vw-rooms'), tp: q('.vw-tp'), toast: q('.vw-toast'), fade: q('.vw-fade'),
      help: q('.vw-help'), loading: q('.vw-loading'),
      gear: q('[data-k=gear]'), zoom: q('.vw-zoom'), zv: q('.vw-zoom .zv'), mapBtn: q('.vw-mapbtn'), prow: q('.vw-prow span'),
      modes: q('.vw-modes'), soon: q('.vw-modes .soon'),
      carChip: q('.vw-carchip'), drive: q('.vw-drive'), carView: q('[data-k=carview]'), carExit: q('[data-k=carexit]'), carLights: q('[data-k=carlights]'), carSound: q('[data-k=carsound]'),
      spdo: q('.vw-spdo'), spd: q('.vw-spdo .spd'), gear: q('.vw-spdo .gear'), lim: q('.vw-spdo .lim'), arc: q('.vw-spdo .arc'),
      steerPad: q('.vw-steer'), knob: q('.vw-steer .knob'), gas: q('.vw-pedals .gas'), brake: q('.vw-pedals .brake'), dhint: q('.vw-dhint'),
      floorsBtn: q('[data-k=floors]'), ucard: q('.vw-ucard'), u1: q('.vw-ucard .u1'), u2: q('.vw-ucard .u2'), ureserve: q('[data-k=ureserve]'),
    };
    this._renderLiftGrid(DEFAULT_SEL.b);
    this._applyTexts();
  }

  // The 2D fallback keypad: the stops of one tower's lifts (−1, 1 … N). Rebuilt when the walker's tower changes.
  _renderLiftGrid(bId) {
    if (!this.el || !BUILDINGS[bId] || this._gridB === bId) return;
    this._gridB = bId;
    const g = this.el.liftGrid; g.innerHTML = '';
    for (const f of liftFloors(bId)) { const b = document.createElement('button'); b.dataset.f = f; b.textContent = floorLabel(f); g.appendChild(b); }
  }

  _applyTexts() {
    const e = this.el; if (!e) return;
    this.root.dir = this.dir;
    this.root.lang = this.lang;
    e.reserve.querySelector('.lbl').textContent = this.t('walk.reserve');
    if (this._cgOpen) this._cgRender(this._cgView);
    if (this._icOpen) this._icRender();
    e.exit.querySelector('.lbl').textContent = this.t('walk.exit');
    e.exit.setAttribute('aria-label', this.t('walk.exit'));
    e.helpBtn.title = this.t('walk.help');
    e.prow.textContent = this.t('walk.help');
    e.gear.title = this.t('walk.settings'); e.gear.setAttribute('aria-label', e.gear.title);
    e.mapBtn.title = this.t('walk.map'); e.mapBtn.setAttribute('aria-label', e.mapBtn.title);
    e.zoom.children[0].title = this.t('walk.zoomOut'); e.zoom.children[0].setAttribute('aria-label', e.zoom.children[0].title);
    e.zoom.children[2].title = this.t('walk.zoomIn'); e.zoom.children[2].setAttribute('aria-label', e.zoom.children[2].title);
    e.photo.querySelector('.lbl').textContent = this.t('walk.photo');
    e.photo.setAttribute('aria-label', this.t('walk.photo'));
    e.modeSeg.children[0].textContent = this.t('walk.walk');
    e.modeSeg.children[1].textContent = this.t('walk.360');
    for (const b of e.timeSeg.children) { b.title = this.t('walk.' + b.dataset.t); b.setAttribute('aria-label', b.title); }
    e.dlabel.textContent = this.t('walk.design');
    e.flabel.textContent = this.t('walk.finish');
    e.liftT.textContent = this.t('walk.lift');
    e.floorsBtn.querySelector('.lbl').textContent = this.t('walk.floors');
    e.ureserve.textContent = this.t('walk.reserveThis');
    e.modes.children[0].textContent = this.t('walk.mode.live');
    e.modes.children[1].textContent = this.t('walk.mode.photo');
    e.modes.setAttribute('aria-label', `${this.t('walk.mode.live')} ⇄ ${this.t('walk.mode.photo')}`);
    e.soon.textContent = this.t('walk.soonApt');
    this._renderModes();
    if (this._cardUnit) this._fillUnitCard(this._cardUnit);
    e.loading.querySelector('.lt').textContent = this.t('walk.loading');
    e.carChip.querySelector('.lbl').textContent = this.t('walk.car.enter');
    e.carExit.querySelector('.lbl').textContent = this.t('walk.car.exit');
    e.carView.querySelector('.lbl').textContent = this.t(this.drive && this.drive.view === 'fp' ? 'walk.car.chase' : 'walk.car.cockpit');
    for (const [b, k] of [[e.carLights, 'walk.car.lights'], [e.carSound, 'walk.car.sound']]) { b.setAttribute('aria-label', this.t(k)); b.title = this.t(k); }
    e.gas.setAttribute('aria-label', this.t('walk.car.gas')); e.gas.title = this.t('walk.car.gas'); e.gas.querySelector('span').textContent = '▲';
    e.brake.setAttribute('aria-label', this.t('walk.car.brake')); e.brake.title = this.t('walk.car.brake'); e.brake.querySelector('span').textContent = 'B · R';
    e.steerPad.setAttribute('aria-label', this.t('walk.car.steer')); e.lim.setAttribute('aria-label', this.t('walk.car.limit'));
    e.dhint.textContent = this.t('walk.car.hint');
    e.help.querySelector('h3').textContent = this.t('walk.help.title');
    e.help.querySelector('[data-k=helpok]').textContent = this.t('walk.help.ok');
    const items = this._isTouch
      ? [['☝', 'walk.help.drag'], ['⇔', 'walk.help.pinch'], ['▲', 'walk.help.pad'], ['⤢', 'walk.help.dbltap'], ['◉', 'walk.help.click'], ['P', 'walk.car.tapCar'], ['360', 'walk.help.360']]
      : [['☝', 'walk.help.drag'], ['W', 'walk.help.keys'], ['⤢', 'walk.help.dblclick'], ['◉', 'walk.help.click'], ['P', 'walk.car.tapCar'], ['360', 'walk.help.360']];
    if (!PROJECT.features || PROJECT.features.drive === false) items.splice(items.findIndex(i => i[1] === 'walk.car.tapCar'), 1);   // no cars to drive
    e.help.querySelector('ul').innerHTML = '';
    for (const [ic, k] of items) { const li = document.createElement('li'); const i = document.createElement('i'); i.textContent = ic; if (ic === '360') i.style.fontSize = '10px'; const s = document.createElement('span'); s.textContent = this.t(k); li.append(i, s); e.help.querySelector('ul').appendChild(li); }
    this._renderTeleports(); this._renderRooms(); this._renderStyles(); this._renderFinish(); this._renderTime(); this._updateTitle(); this._applyModeSafe();
  }
  _applyModeSafe() { if (this.el) this.el.modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === this.mode)); }
  /** Call after the site language changes. */
  refreshTexts() { this._applyTexts(); this._updateHud(true); }

  // Title line: the apartment while you are in it (or before the commons exist); otherwise where you are now —
  // "Будинок 4 · Паркінг −1", "Будинок 4 · Поверх 1 · Лобі", "Будинок 4 · Поверх 7 · Коридор", "Будинок 4 · Поверх 7 · Ліфт".
  _updateTitle(place = this._titlePlace) {
    if (!this.el) return;
    const u = this.unit;
    this._titlePlace = place || null;
    const txt = place || (u ? ((this.i18n && typeof this.i18n.unitLabel === 'function' && this.i18n.unitLabel(u)) || unitLabel(u)) : '');
    if (this.el.t1.dataset.txt === txt && this.el.t1.childNodes.length) return this._updateReserve();
    this.el.t1.dataset.txt = txt;
    this.el.t1.innerHTML = '';
    const br = document.createElement('span'); br.className = 'brand'; br.textContent = txt ? PROJECT.name + ' · ' : PROJECT.name;
    this.el.t1.append(br, document.createTextNode(txt));
    this._updateReserve();
  }
  _updateReserve() {
    const u = this.unit;
    this.el.reserve.querySelector('.vw-price').textContent = u && u.price ? '· ' + money(u.price) : '';
    this.el.reserve.style.display = u && u.status && u.status !== 'available' ? 'none' : '';
  }
  _styleName(id) {
    const s = (this.styles || FALLBACK_STYLES).find(x => x.id === id) || { id, name: id };
    const n = s.name;
    if (typeof n === 'string') return n;
    const lang = String(this.lang).slice(0, 2);
    return (n && n[lang]) || this.t('walk.style.' + id, (n && n.en) || id);
  }
  _renderStyles() {
    if (!this.el) return;
    const box = this.el.styles; box.innerHTML = '';
    this._renderFinish();   // an auto finish follows the style
    for (const s of this.styles || FALLBACK_STYLES) {
      const b = document.createElement('button'); b.textContent = this._styleName(s.id); b.dataset.s = s.id;
      b.classList.toggle('on', s.id === this.styleId); box.appendChild(b);
    }
  }
  // Building finish of the common areas (commons.js COMMON_FINISHES): one chip per finish, the active one lit.
  _renderFinish() {
    if (!this.el || !this.el.finish) return;
    const box = this.el.finish, cur = this._finish(); box.innerHTML = '';
    for (const id of this.finishList) {
      const b = document.createElement('button'); b.dataset.fin = id; b.textContent = this.t('walk.finish.' + id);
      b.classList.toggle('on', id === cur); b.setAttribute('aria-pressed', String(id === cur)); box.appendChild(b);
    }
  }
  _renderTime() { if (this.el) for (const b of this.el.timeSeg.children) b.classList.toggle('on', b.dataset.t === this.envMode); }
  // Jump chips. 'balcony' only when the current flat has an outdoor room; 'parking' goes once its build failed twice;
  // 'entrance' / 'outside' need the tower's ground entrance.
  _renderTeleports() {
    if (!this.el) return;
    const box = this.el.tp; box.innerHTML = '';
    const u = this.unit, ent = u ? coresOf(u.building, 1)[0] : null, hasEnt = !u || !!(ent && ent.entrance && ent.entranceNormal);
    const hasOut = !u || !this.apt || !!this.apt.balconyPoint || (this.rooms || []).some(r => OUTDOOR.has(r.kind));
    for (const k of ['outside', 'entrance', 'lobby', 'corridor', 'apartment', 'balcony', 'parking']) {
      if ((k === 'balcony' && !hasOut) || (k === 'parking' && (this._parkFail || 0) >= 2) || ((k === 'entrance' || k === 'outside') && !hasEnt)) continue;
      const b = document.createElement('button'); b.className = 'vw-chip tp'; b.dataset.tp = k; b.textContent = this.t(k === 'outside' ? 'walk.yard' : 'walk.' + k); box.appendChild(b);
    }
  }
  _renderRooms() {
    if (!this.el) return;
    const box = this.el.rooms; box.innerHTML = '';
    (this.rooms || []).forEach((r, i) => {
      const b = document.createElement('button'); b.className = 'vw-chip'; b.dataset.room = i;
      b.textContent = r.label; box.appendChild(b);
    });
    this._renderTeleports();   // the Balcony chip follows the flat
  }
  _renderLiftPanel() {
    if (!this.el) return;
    const inf = this.riding ? true : this._carOf(this.player.pos);
    if (!inf) this._liftGridOpen = false;
    this.el.lift.classList.toggle('show', !!inf && !!this._liftGridOpen);
    this.el.floorsBtn.classList.toggle('on', !!this._liftGridOpen);
    this.el.floorsBtn.setAttribute('aria-expanded', String(!!this._liftGridOpen));
    this.root.classList.toggle('incar', !!inf);
    this._renderLiftGrid((inf && inf !== true && inf.bId) || (this._inCarInf && this._inCarInf.bId) || this.bId);
    const here = this.riding ? this._liftFloorNow : this.floor;
    this.el.liftInd.textContent = here == null ? '' : floorLabel(here) + (this.riding ? (this._rideTarget > (here ?? 0) ? ' ▲' : ' ▼') : '');
    for (const b of this.el.liftGrid.children) {
      const f = +b.dataset.f;
      b.classList.toggle('on', this.riding && f === this._rideTarget);
      b.classList.toggle('here', !this.riding && f === this.floor);
    }
  }

  _updateHud(force) {
    if (!this.el || !this.unit) return;
    if (!this.riding && this.loaded.size > 1) {   // walked into another loaded apartment → it becomes the current one
      const e = this._aptAt(this.player.pos);
      if (e && e.apt !== this.apt) return this._setCurrent(e);
    }
    let place, kind = 'indoor';
    const inf = !this.riding && this._carOf(this.player.pos);
    const room = !this.riding && !inf && !this.drive ? this._currentRoom() : null;
    let fl = this.riding ? this._liftFloorNow ?? this.floor : this.floor;
    const outside = !this.riding && !inf && this._isOutside(this.player.pos);
    if (this.riding || inf) place = this.t('walk.lift');
    else if (outside) { place = this.t('walk.outside'); kind = 'outdoor'; fl = 1; }
    else if (room) { place = room.label; if (OUTDOOR.has(room.kind)) kind = 'outdoor'; }
    else if (this.floor === -1) place = '';                       // the floor name already says "Паркінг −1"
    else if (isGround(this.floor)) place = this.t('walk.lobby');
    else place = this.t('walk.corridor');
    this._placeKind = kind;
    this._updateTitle(this._placeTitle(room, inf, outside, fl));
    let fname = this._floorName(fl);
    if (outside) { fname = place; place = ''; }
    if (place === fname) place = '';
    if (this.drive) place = place ? place + ' · ' + this.t('walk.car.driving') : this.t('walk.car.driving');
    const txt = place ? `${fname} · ${place}` : fname;
    if (force || txt !== this._lastPlace) {
      this._lastPlace = txt;
      this.el.t2.innerHTML = '';
      const b = document.createElement('b'); b.textContent = fname;
      this.el.t2.append(b, document.createTextNode(place ? ' · ' + place : ''));
      for (const c of this.el.rooms.children) c.classList.toggle('on', room && this.rooms[+c.dataset.room] === room);
    }
    this._renderModes();
    this._exposureFor(kind, inf, room, force);
    const inCarNow = !!inf || this.riding;
    if (inCarNow !== this._wasInCar || this.riding) { this._wasInCar = inCarNow; this._renderLiftPanel(); }
    if (!this.riding) this._hideFloorsForWalker(false);
  }

  // Per-space exposure (eased in _update): bright cove-lit corridors are pulled down, the lift a touch, the parking
  // lifted, balconies follow the sky (dusk/night skies need more exposure than daylight).
  _exposureFor(kind, inf, room, snap = false) {
    const m = this.envMode;
    let e;
    if (this.riding || inf) e = 0.86;
    else if (kind === 'outdoor') e = m === 'day' ? 0.82 : m === 'dusk' ? 1.0 : 1.12;
    else if (room) e = m === 'day' ? 0.9 : m === 'dusk' ? 0.94 : 0.98;
    else if (this.floor === -1) e = 1.08;
    else if (isGround(this.floor)) e = 0.88;
    else e = 0.8;
    if (snap || this._expT == null) this.renderer.toneMappingExposure = e;   // teleports/arrivals happen behind a fade
    this._expT = e;
  }

  _toast(msg, ms = 1600) {
    const t = this.el.toast; t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
  _fade(on) { this.el.fade.style.opacity = on ? '1' : '0'; return new Promise(r => setTimeout(r, 290)); }
  _showLoading(on) { this.el.loading.classList.toggle('hide', !on); if (!on) { this._lastAct = performance.now(); this._setDim(false); } }
  _showHelp(on) { this.el.help.classList.toggle('show', on); if (!on) lsSet('vrc.walk.help', '1'); }

  // ======================= minimap =======================
  // Floor plan of where the walker is: the plate outline of that floor, its hall rects, core (lifts, stairs), the real
  // outlines of the flats and the rooms of the current one; in the car park, the parking slab with the ramps and the
  // four towers above. Zooms onto the flat while inside it. Tag: "Будинок 1 · Поверх 5".
  _drawMap() {
    const cv = this.el.map; if (!cv.offsetParent && cv.offsetWidth === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H || !this.unit || this.floor == null) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, W, H);
    const u = this.unit, bId = this.bId, P = this.player.pos, fl = this.floor, park = fl === -1;
    if (!BUILDINGS[bId]) return;
    const [plx, plz] = worldToLocal(bId, P.x, P.z);
    const uv = this._unitUV(P), cur = this.loaded.get(u.id), B = cur ? this._aptBox(cur) : { u0: 0, u1: u.width, v0: 0, v1: u.depth };
    const inUnit = !this._mapWide && uv && uv.u > B.u0 - 0.3 && uv.u < B.u1 + 0.3 && uv.v > -0.1 && uv.v < B.v1 + 0.3 && u.building === bId && fl === u.floor;
    const uRect = (unit, d = unit.depth) => [[0, 0], [unit.width, 0], [unit.width, d], [0, d]].map(([a, b]) => unitToLocal(unit, a, b));
    const rect = r => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
    const toL = pts => pts.map(([x, z]) => worldToLocal(bId, x, z));
    const fp = footprintOf(bId, park ? 1 : fl);
    let bb;
    if (inUnit) { bb = bboxOf([[B.u0, 0], [B.u1, 0], [B.u1, B.v1], [B.u0, B.v1]].map(([a, b]) => unitToLocal(u, a, b))); bb.x0 -= 0.8; bb.x1 += 0.8; bb.z0 -= 0.8; bb.z1 += 0.8; }
    else if (park) { bb = bboxOf(toL(PARKING.poly)); bb.x0 -= 2; bb.x1 += 2; bb.z0 -= 2; bb.z1 += 2; }
    else { bb = bboxOf(fp.length ? fp : rect({ x0: plx - 15, x1: plx + 15, z0: plz - 15, z1: plz + 15 })); bb.x0 -= 2; bb.x1 += 2; bb.z0 -= 2; bb.z1 += 2; }
    const sc = Math.min(W / (bb.x1 - bb.x0), H / (bb.z1 - bb.z0)), ox = W / 2 - (bb.x0 + bb.x1) / 2 * sc, oz = H / 2 - (bb.z0 + bb.z1) / 2 * sc;
    const X = x => ox + x * sc, Z = z => oz + z * sc;
    const poly = (pts, fill, stroke, lw = 1) => { if (!pts || pts.length < 3) return; ctx.beginPath(); pts.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
    if (park) {
      poly(toL(PARKING.poly), '#17140f', 'rgba(201,164,92,.55)', 1);
      for (const r of RAMPS) poly(toL(rect(r)), '#2b261d', 'rgba(201,164,92,.3)', 0.6);
      for (const id of B_IDS) {   // the towers above, with their lift cores
        poly(footprintOf(id, 1).map(([x, z]) => worldToLocal(bId, ...localToWorldXZ(id, x, z))), id === bId ? 'rgba(201,164,92,.10)' : null, 'rgba(201,164,92,.25)', 0.6);
        const c = coresOf(id, 1)[0];
        for (const L of (c && c.lifts) || []) poly(rect(L).map(([x, z]) => worldToLocal(bId, ...localToWorldXZ(id, x, z))), '#3a3225', 'rgba(230,201,135,.6)', 0.6);
      }
    } else {
      poly(fp, '#17140f', 'rgba(201,164,92,.55)', 1);
      for (const b of blocksOn(bId, fl)) poly(b.poly && b.poly.length >= 3 ? b.poly : rect(b), '#1d1b17', 'rgba(201,164,92,.18)');
      // other flats by their real outline; loaded ones tinted
      for (const x of unitsOn(bId, fl)) poly(x.poly && x.poly.length >= 3 ? x.poly : uRect(x), x.id === u.id ? 'rgba(201,164,92,.28)' : this.loaded.has(x.id) ? 'rgba(201,164,92,.12)' : null, 'rgba(201,164,92,.22)', 0.6);
      for (const c of corridorsOf(bId, fl)) poly(rect(c), '#2b261d');
      const core = coresOf(bId, fl)[0];
      if (core) {
        for (const S of core.stairs || []) poly(rect(S), '#26231e', 'rgba(201,164,92,.3)', 0.6);
        for (const L of core.lifts || []) poly(rect(L), '#3a3225', 'rgba(230,201,135,.6)', 0.6);
        if (isGround(fl) && core.entrance) { ctx.beginPath(); ctx.arc(X(core.entrance[0]), Z(core.entrance[1]), 2.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(230,201,135,.9)'; ctx.fill(); }
      }
      // rooms of the current flat (apartment.js / fallback volume), drawn in its fitted box
      if (u.building === bId && fl === u.floor && this.rooms) {
        const now = this._currentRoom();
        for (const r of this.rooms) {
          if (!r.poly) continue;
          poly(r.poly.map(([a, b]) => unitToLocal(u, a, b)), r === now ? 'rgba(201,164,92,.32)' : OUTDOOR.has(r.kind) ? 'rgba(120,140,110,.18)' : 'rgba(243,234,215,.06)', 'rgba(230,201,135,.75)', inUnit ? 1 : 0.6);
          if (inUnit && sc > 9) {
            const [cx, cz] = unitToLocal(u, r.center[0], r.center[1]);
            ctx.fillStyle = 'rgba(243,234,215,.8)'; ctx.font = `${Math.max(8, Math.min(10, sc * 0.55))}px Manrope,Heebo,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(r.label.slice(0, 12), X(cx), Z(cz));
          }
        }
      }
    }
    // player: view wedge + dot
    const yawL = this.player.yaw - BUILDINGS[bId].rotY, dx = -Math.sin(yawL), dz = -Math.cos(yawL);
    const R = inUnit ? 26 : 16, half = 0.55;
    const g = ctx.createRadialGradient(X(plx), Z(plz), 0, X(plx), Z(plz), R);
    g.addColorStop(0, 'rgba(230,201,135,.55)'); g.addColorStop(1, 'rgba(230,201,135,0)');
    ctx.beginPath(); ctx.moveTo(X(plx), Z(plz));
    const a0 = Math.atan2(dz, dx); ctx.arc(X(plx), Z(plz), R, a0 - half, a0 + half); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(X(plx), Z(plz), 3.4, 0, Math.PI * 2); ctx.fillStyle = '#e6c987'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
    // tag: building number + floor ("Будинок 1 · Поверх 5"; a narrow phone map gets "1 · 5")
    const rtl = this.dir === 'rtl', tag = W < 130 ? `${BUILDINGS[bId].no} · ${floorLabel(fl)}` : `${this._bName(bId)} · ${this._floorName(fl)}`;
    ctx.font = '600 9.5px Manrope,Heebo,sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = rtl ? 'right' : 'left';
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = 'rgba(11,11,11,.72)'; ctx.fillRect(rtl ? W - tw - 10 : 2, 2, tw + 8, 14);
    ctx.fillStyle = 'rgba(230,201,135,.95)'; ctx.fillText(tag, rtl ? W - 6 : 6, 5);
  }

  // ======================= input =======================
  _bind() {
    const c = this.canvas, e = this.el;
    this._h = {
      down: ev => this._onDown(ev), move: ev => this._onMove(ev), up: ev => this._onUp(ev),
      key: ev => this._onKey(ev, true), keyup: ev => this._onKey(ev, false), blur: () => { this.keys.clear(); this.pad = { u: 0, d: 0, l: 0, r: 0 }; },
      vis: () => { this._paused = document.hidden; if (!this._paused) this.clock.getDelta(); },
      ctx: ev => ev.preventDefault(), wheel: ev => this._onWheel(ev),
      hud: ev => this._onHudClick(ev),
      poke: ev => this._onAnyDown(ev),
      touch: ev => { if (ev.cancelable) ev.preventDefault(); },      // no page scroll / pinch-zoom over the 3D view
      gesture: ev => ev.preventDefault(),                              // iOS Safari page pinch
      orient: () => setTimeout(() => this._resize(), 120),
    };
    c.addEventListener('pointerdown', this._h.down);
    c.addEventListener('pointermove', this._h.move);
    c.addEventListener('pointerup', this._h.up);
    c.addEventListener('pointercancel', this._h.up);
    c.addEventListener('contextmenu', this._h.ctx);
    c.addEventListener('wheel', this._h.wheel, { passive: false });
    c.addEventListener('touchstart', this._h.touch, { passive: false });
    c.addEventListener('touchmove', this._h.touch, { passive: false });
    this.root.addEventListener('pointerdown', this._h.poke, true);
    this.root.addEventListener('gesturestart', this._h.gesture);
    this.root.addEventListener('gesturechange', this._h.gesture);
    window.addEventListener('orientationchange', this._h.orient);
    window.addEventListener('keydown', this._h.key);
    window.addEventListener('keyup', this._h.keyup);
    window.addEventListener('blur', this._h.blur);
    document.addEventListener('visibilitychange', this._h.vis);
    e.hud.addEventListener('click', this._h.hud);
    // hold-to-move pad
    for (const b of e.pad.children) {
      const k = b.dataset.p;
      const on = ev => { ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch { /* */ } this.pad[k] = 1; b.classList.add('on'); this.root.classList.add('padon'); this.glide = null; this.touched360 = true; };
      const off = () => { this.pad[k] = 0; b.classList.remove('on'); this.root.classList.toggle('padon', !!(this.pad.u || this.pad.d || this.pad.l || this.pad.r)); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', ev => ev.preventDefault());
    }
    // driving: hold-to-press pedals and a drag steering pad (no tilt needed)
    for (const [b, key] of [[e.gas, 'gas'], [e.brake, 'brake']]) {
      const on = ev => { ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch { /* */ } if (this.drive) this.drive.pad[key] = 1; b.classList.add('on'); };
      const off = () => { if (this.drive) this.drive.pad[key] = 0; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', ev => ev.preventDefault());
    }
    {
      const sp = e.steerPad; let id = null;
      const set = ev => {
        const r = sp.getBoundingClientRect(), k = Math.max(-1, Math.min(1, ((ev.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.35));
        if (this.drive) this.drive.pad.steer = -k;
        e.knob.style.transform = `translateX(${(k * (r.width / 2 - 26)).toFixed(1)}px)`; sp.classList.toggle('on', Math.abs(k) > 0.05);
      };
      const end = () => { id = null; if (this.drive) this.drive.pad.steer = 0; e.knob.style.transform = ''; sp.classList.remove('on'); };
      sp.addEventListener('pointerdown', ev => { ev.preventDefault(); id = ev.pointerId; try { sp.setPointerCapture(id); } catch { /* */ } set(ev); });
      sp.addEventListener('pointermove', ev => { if (ev.pointerId === id) set(ev); });
      sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end); sp.addEventListener('lostpointercapture', end);
    }
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.container);
  }
  _unbind() {
    const c = this.canvas, h = this._h; if (!h) return;
    c.removeEventListener('pointerdown', h.down); c.removeEventListener('pointermove', h.move); c.removeEventListener('pointerup', h.up);
    c.removeEventListener('pointercancel', h.up); c.removeEventListener('contextmenu', h.ctx); c.removeEventListener('wheel', h.wheel);
    c.removeEventListener('touchstart', h.touch); c.removeEventListener('touchmove', h.touch);
    this.root.removeEventListener('pointerdown', h.poke, true);
    this.root.removeEventListener('gesturestart', h.gesture); this.root.removeEventListener('gesturechange', h.gesture);
    window.removeEventListener('orientationchange', h.orient);
    window.removeEventListener('keydown', h.key); window.removeEventListener('keyup', h.keyup); window.removeEventListener('blur', h.blur);
    document.removeEventListener('visibilitychange', h.vis);
    this.el.hud.removeEventListener('click', h.hud);
    this._ro && this._ro.disconnect();
    clearTimeout(this._toastT); clearTimeout(this._cardT);
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    this.renderer.setSize(w, h, false);
    const a = w / Math.max(1, h);
    this.camera.aspect = a;
    // Portrait: fix the horizontal FOV (≈78°) so a phone sees a real room, not a keyhole.
    // Landscape: the classic 68° vertical FOV, horizontally capped.
    this._baseTanH = a < 1 ? Math.tan(HFOV_PORTRAIT / 2 * D2R) : Math.min(Math.tan(VFOV_LANDSCAPE / 2 * D2R) * a, Math.tan(HFOV_LANDSCAPE_MAX / 2 * D2R));
    this._applyFov();
    this.root.classList.toggle('narrow', w < 720);
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const phone = w < 700 || coarse;
    if (phone !== this._phone) {
      this._phone = phone;
      this.root.classList.toggle('phone', phone);
      if (this._mapOpen == null) this._mapOpen = !phone;
      this._setMapOpen(phone ? this._mapOpen : true);
      if (!phone) { this._setPopover(false); this._setDim(false); }
    }
  }
  /** Horizontal-FOV zoom: _zoomS scales tan(½·hFOV) of the default view; clamped to [30°, 110°] horizontally. */
  _applyFov() {
    const cam = this.camera, a = cam.aspect || 1, base = this._baseTanH;
    const t = Math.min(Math.tan(HFOV_MAX / 2 * D2R), Math.max(Math.tan(HFOV_MIN / 2 * D2R), base * this._zoomS));
    this._zoomS = t / base;
    cam.fov = Math.min(VFOV_CAP, 2 * Math.atan(t / a) * R2D);
    cam.updateProjectionMatrix();
    this._hfov = 2 * Math.atan(Math.tan(cam.fov / 2 * D2R) * a) * R2D;
    if (this.el && this.el.zv) this.el.zv.textContent = Math.round(this._hfov) + '°';
  }
  _zoomBy(f) { if (isFinite(f) && f > 0) { this._zoomS *= f; this._applyFov(); } }
  _zoom(dy) { this._zoomBy(Math.exp(Math.max(-120, Math.min(120, dy)) * 0.0015)); }   // dy > 0 → wider view
  _onWheel(ev) {
    ev.preventDefault();
    this._poke();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
    if (ev.ctrlKey) this._zoomBy(Math.exp(Math.max(-60, Math.min(60, dy)) * 0.01));   // trackpad pinch: pinch-in (dy>0) = see more
    else this._zoom(dy);
  }

  // ---- HUD visibility: popover, minimap toggle, auto-fade ----
  _setPopover(open) {
    this._popOpen = !!open;
    if (!this.el) return;
    this.el.tools.classList.toggle('open', this._popOpen);
    this.el.gear.classList.toggle('on', this._popOpen);
    this.el.gear.setAttribute('aria-expanded', String(this._popOpen));
  }
  _setMapOpen(open) {
    this._mapOpen = !!open;
    this.root.classList.toggle('mapoff', !this._mapOpen);
    this._lastMap = 0;
  }
  _poke() { this._lastAct = performance.now(); if (this._dim && !this._dragging && !this._pinch) this._setDim(false); }
  _setDim(on) { if (on === this._dim) return; this._dim = on; this.root.classList.toggle('dim', on); }
  _onAnyDown(ev) {
    this._resumeLive();
    this._poke();
    if (this._popOpen && !(ev.target.closest && ev.target.closest('.vw-tools,.vw-gear'))) {
      this._setPopover(false);
      if (ev.target === this.canvas) this._suppressTap = ev.timeStamp || performance.now();   // closing tap doesn't also open a door
    }
  }
  _updateDim(now) {
    if (!this._phone || !this.el) return this._setDim(false);
    const blocked = this._popOpen || this.el.help.classList.contains('show') || !this.el.loading.classList.contains('hide');
    if (blocked) return this._setDim(false);
    const P = this.player, since = now - this._lastAct;
    const walking = !!this.glide || this.keys.size > 0 || this.pad.u || this.pad.d || P.vel.lengthSq() > 0.05;
    this._setDim(!!(this._dragging || this._pinch || (walking && since > 1200) || since > IDLE_FADE_MS));
  }

  _onDown(ev) {
    this.canvas.focus({ preventScroll: true });
    this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { this.canvas.setPointerCapture(ev.pointerId); } catch { /* */ }
    if (this._pointers.size > 1) { this._startPinch(); return; }
    if (this._pinch) return;
    const P = this.player;
    this._drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: ev.timeStamp || performance.now(), moved: 0,
      yaw: P.yaw, tYaw: P.tYaw, pitch: P.pitch, tPitch: P.tPitch };
    this.touched360 = true;
  }
  // A second finger turns the gesture into a pinch: undo any look-drag the first finger started, forget pending taps.
  _startPinch() {
    const d = this._drag, P = this.player;
    if (d) { P.yaw = d.yaw; P.tYaw = d.tYaw; P.pitch = d.pitch; P.tPitch = d.tPitch; }
    this._drag = null; this._dragging = false; this.canvas.classList.remove('drag');
    this._taps = null;
    const [a, b] = [...this._pointers.values()];
    this._pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s0: this._zoomS };
    this._setDim(true);
  }
  _onMove(ev) {
    const pt = this._pointers.get(ev.pointerId);
    if (pt) { pt.x = ev.clientX; pt.y = ev.clientY; }
    if (this._pinch) {
      if (pt && this._pointers.size >= 2) {
        const [a, b] = [...this._pointers.values()];
        const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        this._zoomS = this._pinch.s0 * this._pinch.d0 / dist;   // fingers together → wider view (see more)
        this._applyFov();
      }
      return;
    }
    const d = this._drag;
    if (!d || d.id !== ev.pointerId) { if (ev.pointerType === 'mouse' && !d) this._hover(ev); return; }
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y; d.x = ev.clientX; d.y = ev.clientY;
    d.moved = Math.max(d.moved, Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy));
    if (d.moved > 4) { this._dragging = true; this.canvas.classList.add('drag'); }
    // touch: "grab the view" — a full-width swipe turns by ≈1.4× the visible horizontal FOV
    const k = ev.pointerType === 'touch'
      ? 1.4 * (this._hfov * D2R) / Math.max(320, this.canvas.clientWidth || 390)
      : 0.0041 * Math.min(1.6, this._zoomS);
    const P = this.player;
    if (this.drive) { const L = this.drive.look; L.yaw = Math.max(-2.6, Math.min(2.6, L.yaw + dx * k)); L.pitch = Math.max(-0.5, Math.min(0.4, L.pitch + dy * k * 0.6)); return; }
    P.tYaw += dx * k; P.tPitch = Math.max(-1.35, Math.min(1.35, P.tPitch + dy * k));
  }
  _onUp(ev) {
    this._pointers.delete(ev.pointerId);
    if (this._pinch) {
      if (this._pointers.size === 0) { this._pinch = null; this._poke(); }
      else if (this._pointers.size >= 2) { const [a, b] = [...this._pointers.values()]; this._pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s0: this._zoomS }; }
      return;
    }
    const d = this._drag; if (!d || d.id !== ev.pointerId) return;
    this._drag = null; this._dragging = false; this.canvas.classList.remove('drag');
    if (ev.type === 'pointercancel') return;
    // event timestamps (not handling time): a long frame between down and up must not turn a tap into a hold
    const tUp = ev.timeStamp || performance.now();
    if (d.moved < 8 && tUp - d.t < 450) this._tap(ev.clientX, ev.clientY, tUp);
  }
  // single tap = use the thing under the pointer; double tap/click = glide there
  _tap(x, y, now = performance.now()) {
    const prev = this._taps;
    if (now - this._suppressTap < 600) { this._taps = null; return; }
    if (prev && now - prev.t < 360 && Math.hypot(x - prev.x, y - prev.y) < 40) {
      this._taps = null;
      this._glideTap(x, y);
      return;
    }
    this._taps = { t: now, x, y };
    if (this.riding || this.drive) return;
    const a = this._pickAction(x, y);
    if (a) return this._doAction(a);
    const car = this.mode === 'walk' && this._pickCarAt(x, y);
    if (car) this._showCarChip(car);
  }
  // Tap → action under the finger; if the exact point misses, try a small ring around it (finger-sized targets on phones).
  _pickAction(x, y) {
    const ok = a => a && a.hit.distance < 7 ? a : null;
    let a = ok(this._actionOf(this._pickAt(x, y)));
    if (a) return a;
    const rads = this._isTouch || this._phone ? [9, 18] : [6];
    for (const r of rads) for (let i = 0; i < 8; i++) {
      const t = i / 8 * Math.PI * 2;
      a = ok(this._actionOf(this._pickAt(x + Math.cos(t) * r, y + Math.sin(t) * r)));
      if (a) return a;
    }
    return null;
  }
  _hover(ev) {
    const now = performance.now(); if (now - this._lastHover < 90) return; this._lastHover = now;
    const a = this._actionOf(this._pickAt(ev.clientX, ev.clientY));
    this.canvas.classList.toggle('act', !!(a && a.hit.distance < 7));
  }
  _onKey(ev, down) {
    if (this.disposed || this._pano || !this.root.isConnected || this.root.offsetParent === null && getComputedStyle(this.root).position !== 'fixed') return;
    const tgt = ev.target;
    if (tgt && tgt.closest && tgt.closest('input,textarea,select,[contenteditable="true"]')) return;
    const code = ev.code;
    if (down && code === 'Escape' && this.el.help.classList.contains('show')) { this._showHelp(false); return; }
    if (down && !ev.repeat && (code === 'KeyF' || code === 'Enter')) {
      if (this.drive) { ev.preventDefault(); return this._exitCar(); }
      if (this._chipRec) { ev.preventDefault(); return this._enterCar(this._chipRec); }
    }
    if (down && !ev.repeat && code === 'KeyC' && this.drive) return this._toggleCarView();
    if (down && !ev.repeat && code === 'KeyL' && this.drive) return this._toggleHeadlights();
    if (down && !ev.repeat && code === 'KeyM' && this.drive) return this._toggleCarSound();
    const moveKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'];
    if (!moveKeys.includes(code)) return;
    if (code === 'Space') { if (!this.drive) return; ev.preventDefault(); }
    if (code.startsWith('Arrow')) ev.preventDefault();
    if (down) { this.keys.add(code); this.touched360 = true; this._poke(); if (this.el.help.classList.contains('show')) this._showHelp(false); }
    else this.keys.delete(code);
  }

  // ======================= outdoor world, cars, driving =======================
  // Outdoor colliders (cars.js buildOutdoorColliders: the four towers' ground-floor outlines with gaps at the
  // entrances, the podium, the neighbours, a walkable ground with holes over the ramps). Needed for walking in the
  // courtyard whether or not driving is enabled; a plain fallback is built when cars.js is missing or throws.
  _initOutdoor() {
    if (this.outdoor) return;
    const C = this.mods.cars;
    try { if (C && C.buildOutdoorColliders) this.outdoor = C.buildOutdoorColliders(); } catch (e) { console.warn('[walk] outdoor colliders unavailable', e); this.outdoor = null; }
    if (!this.outdoor || !this.outdoor.group) this.outdoor = this._fallbackOutdoor();
    this.scene.add(this.outdoor.group);
    this._register(this.outdoor.group, 'outdoor');
  }
  // Ground plane (holes over the ramps) + a thin wall along every edge of each tower's ground-floor outline, open ±1 m
  // at its entrance. Invisible; same names / flags as cars.js ('outdoor-solid', 'outdoor-floor').
  _fallbackOutdoor() {
    const group = new THREE.Group(); group.name = 'walk-fallback-outdoor';
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const add = (geo, flag) => { const m = new THREE.Mesh(geo, mat); m.userData[flag] = true; m.userData.collider = true; m.name = 'outdoor-' + flag; group.add(m); return m; };
    for (const id of B_IDS) {
      const pts = footprintOf(id, 1), c = coresOf(id, 1)[0], ent = c && c.entrance, rot = BUILDINGS[id].rotY;
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L, spans = [];
        const te = ent ? (ent[0] - ax) * ux + (ent[1] - az) * uz : -9, de = ent ? Math.abs((ent[0] - ax) * uz - (ent[1] - az) * ux) : 9;
        if (de < 0.6 && te > -0.5 && te < L + 0.5) { spans.push([0, te - 1.0], [te + 1.0, L]); } else spans.push([0, L]);
        for (const [t0, t1] of spans) {
          if (t1 - t0 < 0.05) continue;
          const tm = (t0 + t1) / 2, [wx, wz] = localToWorldXZ(id, ax + ux * tm, az + uz * tm);
          const m = add(new THREE.BoxGeometry(t1 - t0, 4, 0.3), 'solid');
          m.position.set(wx, 2, wz); m.rotation.y = Math.atan2(-uz, ux) + rot;
        }
      }
    }
    // ground: ±350 m around the site, cut along x and z at the ramp rects so each ramp leaves a hole
    const X0 = SITE_CENTER[0] - 350, X1 = SITE_CENTER[0] + 350, Z0 = SITE_CENTER[1] - 350, Z1 = SITE_CENTER[1] + 350;
    const xs = [...new Set([X0, X1, ...RAMPS.flatMap(r => [r.x0, r.x1])])].sort((a, b) => a - b), zs = [...new Set([Z0, Z1, ...RAMPS.flatMap(r => [r.z0, r.z1])])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (RAMPS.some(r => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1)) continue;
      const g = new THREE.PlaneGeometry(xs[i + 1] - xs[i], zs[j + 1] - zs[j]); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz); add(g, 'floor');
    }
    group.updateMatrixWorld(true);
    return { group, _fallback: true, dispose() { group.traverse(o => o.geometry && o.geometry.dispose()); mat.dispose(); } };
  }
  // Every car in the car park and along the nearby kerbs is a record in one fleet (cars.js); the nearest few are
  // detailed models. Tap one → "Enter car" chip → drive it (first-person or chase camera). Optional:
  // PROJECT.features.drive === false, a missing cars.js or any throw here simply leaves the tour without cars.
  _initCars() {
    const C = this.mods.cars;
    if (!PROJECT.features || PROJECT.features.drive === false || !C || !C.createFleet || !C.CarController) { this.fleet = null; return; }
    try {
      this.fleet = C.createFleet({ maxDetailed: this._isTouch ? 4 : 6, detailRadius: 26 });
      this.scene.add(this.fleet.group);
      // one headlight spot, present from the start so the light count never changes (no shader recompiles later)
      this.headSpot = new THREE.SpotLight(0xfff1dc, 0, 42, 0.62, 0.6, 1.3); this.headSpot.name = 'walk-car-headlights';
      this.scene.add(this.headSpot, this.headSpot.target);
      Promise.resolve(this.env && this.env.ready).then(() => { if (!this.disposed) this._adoptOutdoorCars(); }).catch(e => console.warn('[walk] cars', e));
    } catch (e) { console.warn('[walk] cars unavailable', e); try { this.fleet && this.fleet.dispose && this.fleet.dispose(); } catch { /* */ } this.fleet = null; }
  }
  _registerCars() { this._unregister('cars'); if (this.fleet) this._register(this.fleet.colliders, 'cars'); }
  _adoptParking(c) {
    if (!this.fleet || !c || !Array.isArray(c.parkedCars)) return;
    try {
      if (this.fleet.add(c.parkedCars, 'parking').length) this._registerCars();
      if (c.carInstances && c.carInstances.group) c.carInstances.group.visible = false;   // the fleet draws them now
    } catch (e) { console.warn('[walk] parked cars', e); }
  }
  _adoptOutdoorCars() {
    const C = this.mods.cars;
    if (!this.fleet || !this.env || !this.env.group || !C) return;
    const ctx = this.env.modules && this.env.modules.context;
    // the car parks' light poles stop a car (and a walker) too
    if (ctx && Array.isArray(ctx.poles) && !this.outdoorPoles) {
      // (not the ones standing in the drive lane hard by a building or the P deck: they would pinch the lane shut)
      const clear = ([x, z]) => { const o = new THREE.Vector3(x, 1, z), near = this._near(this.solids, o, 6.5).filter(q => !q.userData.floor && !q.userData.carId); for (let k = 0; k < 8; k++) if (this._cast(near, o, new THREE.Vector3(Math.cos(k * Math.PI / 4), 0, Math.sin(k * Math.PI / 4)), 6).length) return false; return true; };
      const boxes = ctx.poles.filter(q => !q[2] && clear(q)).map(([x, z]) => [x - 0.14, x + 0.14, 0, 3, z - 0.14, z + 0.14]);
      if (boxes.length && C.buildOutdoorColliders) { this.outdoorPoles = C.buildOutdoorColliders({ extraOnly: true, extraBoxes: boxes }); this.scene.add(this.outdoorPoles.group); this._register(this.outdoorPoles.group, 'outdoor'); }
    }
    if (ctx && ctx.cars && ctx.cars.list && ctx.cars.instances) {
      const idx = [], list = [];
      ctx.cars.list.forEach((c, i) => { if (!c.deck && Math.abs(c.y) < 0.5) { idx.push(i); list.push(c); } });
      // every candidate leaves the context's instances; the ones that clash (another car, a wall) are not re-added
      if (this.fleet.add(list, 'lots', c => this._spotFree(c)).length) { idx.forEach(i => ctx.cars.instances.setHidden(i, true)); ctx.cars.instances.update(); }
    }
    // the environment's kerbside and moving traffic: luxury far model; nearby kerb cars become drivable
    let traffic = null; const cands = [];
    this.env.group.traverse(o => {
      if (!o.isInstancedMesh || !o.geometry || !o.geometry.attributes.color || !o.material || !o.material.vertexColors) return;
      if (o.frustumCulled === false && o.instanceMatrix.usage === THREE.DynamicDrawUsage) traffic = o; else cands.push(o);
    });
    if (!traffic || !C.carGeometryXForward || !C.carRng || !C.pickCar) { this._registerCars(); return; }
    const old = traffic.geometry, lux = C.carGeometryXForward('sedan');
    const nearPlot = typeof C.nearPlot === 'function' ? C.nearPlot : () => false;
    const kerb = [], rc = C.carRng(777), m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), p = new THREE.Vector3();
    for (const o of cands) if (o.geometry === old) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        if (Math.hypot(p.x - SITE_CENTER[0], p.z - SITE_CENTER[1]) > 190) continue;
        // the streets framing the site are kept clear (their kerb parking would leave too narrow a lane to drive)
        if (nearPlot(p.x, p.z, 16)) { o.setMatrixAt(i, zero); continue; }
        const e = m.elements, yawX = Math.atan2(-e[2], e[0]);
        kerb.push({ x: p.x, y: 0, z: p.z, yaw: yawX + Math.PI / 2, ...C.pickCar(rc) }); o.setMatrixAt(i, zero);
      }
      o.instanceMatrix.needsUpdate = true; o.geometry = lux;
    }
    traffic.geometry = lux;
    this.fleet.add(kerb, 'kerb', c => this._spotFree(c));
    this._registerCars();
  }
  // a parked car at c = {kind, x, y, z, yaw} touches no wall / building / car collider
  _spotFree(c) {
    const S = this.mods.cars.carSpec(c.kind), ctl = { S, rec: { collider: null }, v: 1 };
    for (const v of [1, -1]) { ctl.v = v; if (this._carBlocked(ctl, c.x, c.z, c.yaw, c.y)) return false; }
    return true;
  }
  // ---- where are we?
  // Inside the ground-floor outline of a tower (the lobby level decides what "outside" is).
  _inFootprint(x, z) {
    for (const id of B_IDS) { const [lx, lz] = worldToLocal(id, x, z); if (pointInPoly([lx, lz], footprintOf(id, 1))) return id; }
    return null;
  }
  _isOutside(p = this.player.pos) { return p.y > -0.75 && p.y < 2.5 && !this._inFootprint(p.x, p.z); }
  _nearestBuilding(x, z) {
    let best = B_IDS[0], bd = Infinity;
    for (const id of B_IDS) { const [cx, cz] = buildingCenter(id), d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; best = id; } }
    return best;
  }
  // Distance to the nearest car-park ramp (0 on it); world coordinates.
  _rampDist(x, z) { let d = Infinity; for (const r of RAMPS) d = Math.min(d, rectDist(r, x, z)); return d; }
  // Load the commons the walker (or driver) is heading into: the car park at a ramp, a tower's ground floor near its
  // entrance. A ramp may run through a tower (R1 through tower 1), so the order matters: on a ramp → car park; inside
  // a tower at grade → nothing changes; on foot near an entrance → that lobby; close to a ramp → car park.
  _outdoorWatch() {
    const now = performance.now(); if (now - (this._owT || 0) < 300 || this._swapBusy || this.riding || this.busy) return;
    this._owT = now;
    const P = this.player.pos;
    if (P.y < -4.6 || P.y > 1.5) return;
    const rd = this._rampDist(P.x, P.z), cur = this.bId || (this.unit && this.unit.building) || this._nearestBuilding(P.x, P.z);
    let want = null;
    if (rd < 0.5 && (P.y < -0.3 || this.drive)) want = [cur, -1];
    else if (P.y > -0.6 && !this.drive) {
      if (this._inFootprint(P.x, P.z)) return;                 // in a lobby: its commons are loaded already
      let bd = 7;
      for (const id of B_IDS) {
        const c = coresOf(id, 1)[0]; if (!c || !c.entrance) continue;
        const [x, z] = localToWorldXZ(id, c.entrance[0], c.entrance[1]), d = Math.hypot(P.x - x, P.z - z);
        if (d < bd) { bd = d; want = [id, 1]; }
      }
      // keep the lobby that is loaded while its entrance is still close (no flip-flop between a lobby and the car park)
      if (!want && this.commons && isGround(this.commons.floor)) {
        const c = coresOf(this.commons.bId, 1)[0];
        if (c && c.entrance) { const [x, z] = localToWorldXZ(this.commons.bId, c.entrance[0], c.entrance[1]); if (Math.hypot(P.x - x, P.z - z) < 11) return; }
      }
      if (!want && rd < 6) want = [cur, -1];
    } else if (rd < 16) want = [cur, -1];
    if (!want || (this.floor === want[1] && (want[1] === -1 || this.bId === want[0]))) return;
    this._swapBusy = true;
    this._setFloor(want[0], want[1]).catch(e => console.warn('[walk] floor swap', e)).finally(() => { this._swapBusy = false; });
  }
  // Automatic sliding doors of the lobbies. From inside they open on approach (and stay unlocked for a moment after you
  // step out); from the forecourt they are locked until the video intercom beside them releases them.
  _autoDoors(dt) {
    const c = this.commons; if (!c || !c.autoDoors || !c.autoDoors.length) return;
    const P = this.player.pos, now = performance.now(), level = Math.abs(P.y - floorY(c.bId, 1)) < 2;
    const inside = level && this._inFootprint(P.x, P.z) === c.bId;
    for (const d of c.autoDoors) {
      const [x, z] = localToWorldXZ(c.bId, d.x, d.z), dist = level ? Math.hypot(P.x - x, P.z - z) : 99;
      const key = c.bId + ':' + d.stair, rel = this._entryOpen && this._entryOpen[key], age = rel ? now - rel : Infinity;
      if (inside && dist < 3.4) d.grace = now;
      if (rel && age > ENTRY_UNLOCK_MS) { delete this._entryOpen[key]; const rec = (c.intercoms || []).find(i => i.stair === d.stair); if (rec) rec.setOpen(false); }
      const free = d.stair == null || inside || age < ENTRY_UNLOCK_MS || now - (d.grace || -1e9) < ENTRY_GRACE_MS;
      // open: someone allowed is near, the intercom has just released it, or somebody stands in the open doorway
      const t = (free && dist < 3.4) || age < ENTRY_HOLD_MS || (dist < 1.3 && d.open > 0.5) ? 1 : 0;
      if (!free && dist < 2.3 && !this.drive && !this._icOpen && this.el && now - (this._lockHintT || 0) > 7000) { this._lockHintT = now; this._toast(this.t('walk.ic.locked'), 2600); }
      if (d.blocker) d.blocker.userData.solid = d.open < 0.6;
      const prev = d.open; d.open += (t - d.open) * damp(4.5, dt);
      if (Math.abs(prev - d.open) < 1e-4) continue;
      for (const g of d.leaves) { g.position.x = g.userData.baseX + g.userData.dir * d.open * d.travel; g.updateMatrixWorld(true); }
    }
  }

  // ---- picking a car
  _pickCarAt(clientX, clientY) {
    if (!this.fleet || this.drive || this.riding) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = this.fleet.raycast(ray.ray, 16);
    if (!hit) return null;
    // a wall between us and the car wins
    const solids = this._near(this.solids, ray.ray.origin, 16).filter(o => !o.userData.carId && !o.userData.floor);
    const wall = this._cast(solids, ray.ray.origin, ray.ray.direction, hit.distance).find(h => !h.object.userData.floor);
    return wall && wall.distance < hit.distance - 0.3 ? null : hit.rec;
  }
  _showCarChip(rec, ms = 7000) {
    this._chipRec = rec; this.el.carChip.classList.add('show');
    clearTimeout(this._chipT); if (ms) this._chipT = setTimeout(() => { if (!this._chipNear) this._hideCarChip(); }, ms);
  }
  _hideCarChip() { this._chipRec = null; this._chipNear = false; this.el && this.el.carChip.classList.remove('show'); }
  _carChipWatch() {
    const now = performance.now(); if (now - (this._ccT || 0) < 250) return; this._ccT = now;
    if (!this.fleet || this.drive || this.mode !== 'walk') return;
    const n = this.fleet.nearest(this.player.pos, 1.5);
    if (n) { this._chipNear = true; if (this._chipRec !== n.rec) this._showCarChip(n.rec, 0); }
    else if (this._chipNear) { this._chipNear = false; this._hideCarChip(); }
  }

  // ---- entering / leaving
  async _enterCar(rec = this._chipRec) {
    if (!rec || !this.fleet || this.drive || this.riding || this.busy) return;
    this.busy = true; this._hideCarChip();
    try {
      await this._fade(true);
      this.fleet.setFocus(rec); this.fleet.update(this.camera, true);
      const car = this.fleet.carOf(rec);
      if (!car) return;
      const ctl = new this.mods.cars.CarController(rec);
      this._fovWalk = this.camera.fov;
      this.drive = { rec, car, ctl, view: lsGet('vrc.walk.carView') === 'chase' ? 'chase' : 'fp', look: { yaw: 0, pitch: 0 }, pad: { gas: 0, brake: 0, steer: 0 }, cam: null, lights: null };
      this.glide = null; this.player.vel.set(0, 0, 0); this.keys.clear();
      car.setInside(this.drive.view === 'fp');
      this.root.classList.add('driving');
      this._renderDriveHud(true);
      if (lsGet('vrc.walk.carSound') === 'on') this._engineStart(rec.kind);   // engine sound is opt-in (muted by default)
      this._driveUpdate(0);
    } finally { this.busy = false; await this._fade(false); }
  }
  async _exitCar() {
    const D = this.drive; if (!D || this.busy) return;
    this.busy = true;
    try {
      await this._fade(true);
      const { rec, car, ctl } = D, S = ctl.S;
      Object.assign(rec, { x: ctl.x, y: ctl.y, z: ctl.z, yaw: ctl.yaw, pitch: ctl.pitch, roll: 0 });
      this._engineStop();
      car.setInside(false); car.setLights(false); if (this.headSpot) this.headSpot.intensity = 0;
      this.fleet.setFocus(null); this.fleet.moved(rec);
      for (const e of this.solids) if (e.o === rec.collider) e.box = null;
      this.drive = null;
      this.root.classList.remove('driving');
      this._applyFov();
      // stand next to the driver's door (left, +x), else the other side, else behind / in front
      const c = Math.cos(ctl.yaw), s = Math.sin(ctl.yaw), toW = (lx, lz) => [ctl.x + lx * c + lz * s, ctl.z - lx * s + lz * c];
      const spots = [[S.W / 2 + 0.55, S.seat], [-(S.W / 2 + 0.55), S.seat], [0, S.zR - 0.8], [0, S.zF + 0.8], [S.W / 2 + 1.2, S.seat]];
      let pos = null;
      for (const [lx, lz] of spots) {
        const [x, z] = toW(lx, lz);
        const fy = this._floorAt(x, ctl.y + 0.3, z, this._near(this.floors, new THREE.Vector3(x, ctl.y, z), 2));
        if (fy == null) continue;
        if (this._isFree(x, fy, z)) { pos = new THREE.Vector3(x, fy, z); break; }
      }
      if (!pos) { const [x, z] = toW(S.W / 2 + 0.55, S.seat); const [fx, fz] = this._freeSpot(x, ctl.y, z, 3); pos = new THREE.Vector3(fx, ctl.y, fz); }
      this._place(pos, ctl.yaw + Math.PI - 0.5);
      this.player.eye = EYE;
      this._lastPlace = null; this._updateHud(true);
    } finally { this.busy = false; await this._fade(false); }
  }
  // headlights: automatic (dusk / night / underground) until toggled; the sound button starts / stops the engine synth
  _toggleHeadlights() {
    const D = this.drive; if (!D) return;
    D.lights = !this._lightsOn(D);
    this._renderDriveHud(true);
  }
  _lightsOn(D = this.drive) { return D ? (D.lights != null ? D.lights : this.envMode !== 'day' || D.ctl.y < -0.8) : false; }
  _toggleCarSound() {
    const D = this.drive; if (!D) return;
    const on = !this._eng;
    lsSet('vrc.walk.carSound', on ? 'on' : 'off');
    if (on) this._engineStart(D.rec.kind); else this._engineStop();
    this._renderDriveHud(true);
  }
  _toggleCarView() {
    const D = this.drive; if (!D) return;
    D.view = D.view === 'fp' ? 'chase' : 'fp'; D.cam = null; D.look.yaw = D.look.pitch = 0;
    D.car.setInside(D.view === 'fp'); lsSet('vrc.walk.carView', D.view);
    this._renderDriveHud(true);
  }

  // ---- the physics world for CarController
  _groundAt(x, y, z) {
    const o = this._v1.set(x, y + 0.9, z);
    const hits = this._cast(this._near(this.floors, o, 3), o, this._v2.set(0, -1, 0), 2.0);
    for (const h of hits) if (h.point.y <= y + 0.62) return h.point.y;
    return null;
  }
  _carBlocked(ctl, x, z, yaw, y) {
    const S = ctl.S, hw = S.W / 2 + 0.02, zf = S.zF + 0.04, zr = S.zR - 0.04, zc = (zf + zr) / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw), W = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const [cx, cz] = W(0, zc);
    const center = this._v1.set(cx, y + 0.6, cz);
    const own = ctl.rec.collider;
    const onRamp = this._rampDist(x, z) < 0.3;   // a ramp through a tower: the tower's street-level shell must not close it
    const solids = this._near(this.solids, center, S.L / 2 + 1.2).filter(o => o !== own && !o.userData.floor && !(onRamp && o.name === 'outdoor-solid'));
    if (!solids.length) return false;
    const pts = [], fwd = ctl.v >= 0;
    for (const k of [-1, -0.5, 0, 0.5, 1]) pts.push([k * hw, fwd ? zf : zr]);
    for (const k of [0.2, 0.5, 0.8]) for (const sx of [-1, 1]) pts.push([sx * hw, fwd ? lerpN(zc, zf, k) : lerpN(zc, zr, k)]);
    for (const sx of [-1, 1]) pts.push([sx * hw, fwd ? zr + 0.3 : zf - 0.3]);   // the swinging far end while turning
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const h of [0.42, 0.95]) {
      o.set(cx, y + h, cz);
      for (const [lx, lz] of pts) {
        const [px, pz] = W(lx, lz); d.set(px - cx, 0, pz - cz); const L = d.length(); if (L < 1e-3) continue; d.divideScalar(L);
        const hit = this._cast(solids, o, d, L).find(q => !q.object.userData.floor);
        if (hit) return true;
      }
    }
    return false;
  }
  _driveArea() {
    const C = this.mods.cars;
    if (this._dArea || !this.env || !this.env.group || !C || !C.createDriveArea) return this._dArea || null;
    if (!this.env.group.getObjectByName('road-strips')) return null;   // streets not built yet
    try { this._dArea = C.createDriveArea(this.env.group, { center: SITE_CENTER }); } catch (e) { console.warn('[walk] drive area', e); this._dArea = null; }
    return this._dArea;
  }
  _driveWorld() {
    if (this._dw) return this._dw;
    return (this._dw = {
      ground: (x, y, z) => this._groundAt(x, y, z),
      blocked: (ctl, x, z, yaw, y) => this._carBlocked(ctl, x, z, yaw, y),
      limit: (x, y) => (y < -0.8 ? 20 : 50) / 3.6,
      // underground: the car-park walls bound it; above ground: the site and the streets around it (cars.js drive
      // area, centred on the site); without one, a 300 m circle around the courtyard
      drivable: (x, z) => {
        if (this.drive && this.drive.ctl.y < -1) return true;
        const A = this._driveArea();
        if (A ? A.test(x, z) : Math.hypot(x - SITE_CENTER[0], z - SITE_CENTER[1]) < 300) return true;
        const now = performance.now(); if (now - (this._edgeT || 0) > 4000) { this._edgeT = now; this._toast && this._toast(this.t('walk.car.edge')); }
        return false;
      },
    });
  }

  // ---- per-frame driving
  _driveUpdate(dt) {
    const D = this.drive, { ctl, car, rec } = D, k = this.keys, pad = D.pad;
    const gas = Math.max(k.has('KeyW') || k.has('ArrowUp') ? 1 : 0, pad.gas);
    const brake = Math.max(k.has('KeyS') || k.has('ArrowDown') || k.has('Space') ? 1 : 0, pad.brake);
    let steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
    const inp = { gas, brake, steer }, world = this._driveWorld();
    const n = Math.min(6, Math.max(1, Math.ceil(dt / (1 / 60))));
    const hit0 = ctl.hit; ctl.hit = 0;
    for (let i = 0; i < n; i++) ctl.step(dt / n, inp, world);
    if (ctl.hit > 1.2 && !hit0) this._thud(Math.min(1, ctl.hit / 6));
    // car pose
    Object.assign(rec, { x: ctl.x, y: ctl.y, z: ctl.z, yaw: ctl.yaw, pitch: ctl.pitch, roll: ctl.roll });
    const g = car.group;
    g.position.set(ctl.x, ctl.y + ctl.bump * Math.sin(performance.now() / 30), ctl.z);
    g.rotation.set(-ctl.pitch, ctl.yaw, ctl.roll, 'YXZ');
    g.updateMatrixWorld(true);
    car.setWheels(ctl.spin, ctl.steer);
    this.player.pos.set(ctl.x, ctl.y, ctl.z);
    // lights: on at dusk/night and underground; brake lights while braking or holding the brake at a standstill
    const under = ctl.y < -0.8, on = this._lightsOn(D);
    car.setLights(on, ctl.braking || (brake > 0 && Math.abs(ctl.v) < 0.3 && !ctl.reversing), ctl.reversing);
    const fx = Math.sin(ctl.yaw), fz = Math.cos(ctl.yaw);
    const S = ctl.S;
    this.headSpot.intensity = on ? (under ? 55 : 90) : 0;
    this.headSpot.position.set(ctl.x + fx * (S.zF - 0.3), ctl.y + 0.72, ctl.z + fz * (S.zF - 0.3));
    this.headSpot.target.position.set(ctl.x + fx * (S.zF + 14), ctl.y - 0.6, ctl.z + fz * (S.zF + 14));
    this.headSpot.target.updateMatrixWorld(true);
    // camera
    const cam = this.camera, L = D.look;
    if (!this._dragging) { L.yaw *= 1 - damp(2.2, dt); L.pitch *= 1 - damp(2.2, dt); }
    const vf = D.view === 'fp' ? Math.min(this._fovWalk || cam.fov, cam.aspect < 1 ? 92 : 70) : Math.min(this._fovWalk || cam.fov, cam.aspect < 1 ? 100 : 72);
    if (Math.abs(cam.fov - vf) > 0.01) { cam.fov = vf; cam.updateProjectionMatrix(); }
    if (D.view === 'fp') {
      const e = car.group.localToWorld(car.eye.clone());
      cam.position.copy(e);
      cam.rotation.set(ctl.pitch * 0.9 - 0.05 + L.pitch, ctl.yaw + Math.PI + L.yaw, -ctl.roll * 0.6, 'YXZ');
    } else {
      const dist = under ? 5.4 : 6.6, h = under ? 1.75 : 2.5;
      const a = ctl.yaw + L.yaw;
      const want = new THREE.Vector3(ctl.x - Math.sin(a) * dist, ctl.y + h, ctl.z - Math.cos(a) * dist);
      // keep the camera on our side of walls/columns and under the car-park ceiling
      const from = new THREE.Vector3(ctl.x, ctl.y + 1.3, ctl.z), dir = want.clone().sub(from), len = dir.length(); dir.divideScalar(len);
      const sol = this._near(this.solids, from, len + 1).filter(o => o !== rec.collider && !o.userData.carId);
      const hit = this._cast(sol, from, dir, len).find(q => !q.object.userData.floor);
      if (hit) want.copy(from).addScaledVector(dir, Math.max(0.6, hit.distance - 0.35));
      if (!D.cam) D.cam = want.clone(); else D.cam.lerp(want, damp(dt ? 7 : 1000, dt || 1));
      cam.position.copy(D.cam);
      cam.lookAt(ctl.x + fx * 1.6, ctl.y + 1.0 + L.pitch * 3, ctl.z + fz * 1.6);
    }
    this._syncEnvMap();
    this._engineUpdate(ctl, gas, dt);
    if (this.fleet) this.fleet.update(cam);
    this._renderDriveHud(false);
  }
  _renderDriveHud(force) {
    const D = this.drive, e = this.el; if (!D || !e) return;
    const kmh = Math.round(Math.abs(D.ctl.v) * 3.6), lim = D.ctl.y < -0.8 ? 20 : 50;
    if (force || kmh !== this._lastKmh) { this._lastKmh = kmh; e.spd.textContent = String(kmh); e.gear.textContent = D.ctl.v < -0.1 || D.ctl.reversing ? 'R' : kmh ? 'D' : 'P'; const f = Math.min(1, Math.abs(D.ctl.v) * 3.6 / 60); e.arc.style.strokeDasharray = `${(141.4 * f).toFixed(1)} 200`; }
    if (force || lim !== this._lastLim) { this._lastLim = lim; e.lim.textContent = String(lim); }
    e.spdo.classList.toggle('over', kmh > lim + 1);
    if (force) {
      e.carLights.classList.toggle('on', this._lightsOn(D)); e.carSound.classList.toggle('on', !!this._eng);
      e.carView.querySelector('.lbl').textContent = this.t(D.view === 'fp' ? 'walk.car.chase' : 'walk.car.cockpit');
      e.carExit.querySelector('.lbl').textContent = this.t('walk.car.exit');
    }
  }

  // ---- sound: engine synth (pitch follows speed), road noise, bump thud — only after a user gesture
  _engineStart(kind) {
    const ac = this._audio(); if (!ac) return;
    try {
      const t = ac.currentTime, ev = kind === 'ev';
      const out = ac.createGain(); out.gain.value = 0; out.connect(ac.destination);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = ev ? 2400 : 520; lp.Q.value = 0.8; lp.connect(out);
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g1 = ac.createGain(), g2 = ac.createGain();
      o1.type = ev ? 'sine' : 'sawtooth'; o2.type = ev ? 'triangle' : 'square';
      g1.gain.value = ev ? 0.35 : 0.55; g2.gain.value = ev ? 0.12 : 0.28;
      o1.connect(g1).connect(lp); o2.connect(g2).connect(lp);
      const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 3; }
      const ns = ac.createBufferSource(); ns.buffer = buf; ns.loop = true;
      const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 380; nf.Q.value = 0.6;
      const ng = ac.createGain(); ng.gain.value = 0; ns.connect(nf).connect(ng).connect(ac.destination);
      o1.start(t); o2.start(t); ns.start(t);
      out.gain.setTargetAtTime(ev ? 0.03 : 0.06, t, 0.25);
      if (!ev) { o1.frequency.setValueAtTime(18, t); o1.frequency.setTargetAtTime(38, t + 0.05, 0.12); }   // starter → idle
      this._eng = { ac, out, lp, o1, o2, ng, ns, ev, rpm: 750 };
    } catch (e) { console.warn('[walk] engine sound', e); this._eng = null; }
  }
  _engineUpdate(ctl, gas, dt) {
    const E = this._eng; if (!E) return;
    const t = E.ac.currentTime, v = Math.abs(ctl.v) * 3.6;
    if (E.ev) {
      const f = 140 + v * 22;
      E.o1.frequency.setTargetAtTime(f, t, 0.06); E.o2.frequency.setTargetAtTime(f * 2.01, t, 0.06);
      E.out.gain.setTargetAtTime(0.012 + Math.min(0.03, v * 0.0008) + gas * 0.012, t, 0.1);
    } else {
      const gears = [0, 18, 34, 52, 75], gi = Math.max(0, gears.findIndex((g, i) => v < (gears[i + 1] ?? 999)));
      const lo = gears[gi], hi = gears[gi + 1] ?? 120, frac = (v - lo) / (hi - lo);
      const target = 750 + frac * 2600 + gas * 500;
      E.rpm += (target - E.rpm) * damp(5, dt || 0.016);
      const f = E.rpm / 60 * 2;   // V8: 4 firing pulses per rev, heard an octave down
      E.o1.frequency.setTargetAtTime(f, t, 0.05); E.o2.frequency.setTargetAtTime(f / 2, t, 0.05);
      E.lp.frequency.setTargetAtTime(260 + E.rpm * 0.22 + gas * 500, t, 0.08);
      E.out.gain.setTargetAtTime(0.045 + gas * 0.035, t, 0.1);
    }
    E.ng.gain.setTargetAtTime(Math.min(0.06, v * 0.0012), t, 0.2);
  }
  _engineStop() {
    const E = this._eng; if (!E) return; this._eng = null;
    try { const t = E.ac.currentTime; E.out.gain.setTargetAtTime(0, t, 0.12); E.ng.gain.setTargetAtTime(0, t, 0.12); for (const n of [E.o1, E.o2, E.ns]) n.stop(t + 0.8); } catch { /* optional */ }
  }
  _thud(k = 1) {
    const ac = this._audio(); if (!ac) return;
    try {
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      g.gain.setValueAtTime(0.25 * k, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.3);
    } catch { /* optional */ }
    if (navigator.vibrate) try { navigator.vibrate(30); } catch { /* optional */ }
  }

  // Underground (away from the ramp) nothing above grade is visible: skip drawing the exterior and the city.
  _cullWorld() {
    const now = performance.now(); if (now - (this._cwT || 0) < 250) return; this._cwT = now;
    const c = this.camera.position;
    const under = c.y < -0.6 && this._rampDist(c.x, c.z) > 22;
    if (under === !!this._culled) return;
    this._culled = under;
    if (under) {
      this._cullList = [];
      const skip = o => { let l = false; o.traverse(q => { if (q.isLight) l = true; }); return l; };
      for (const root of [this.env && this.env.group, this.complex && this.complex.group]) if (root) for (const o of root.children) if (o.visible && !o.isLight && !skip(o)) { o.visible = false; this._cullList.push(o); }
      this._cullMode = this.envMode;
    } else {
      for (const o of this._cullList || []) o.visible = true;
      this._cullList = [];
      if (this._cullMode && this._cullMode !== this.envMode && this.env) try { this.env.setMode(this.envMode); } catch { /* */ }
    }
  }

  _onHudClick(ev) {
    if (this._phone && ev.target.closest('.vw-map')) return this._setMapOpen(false);
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.cg) return this._cgAction(b.dataset.cg, b);
    if (b.dataset.ic) return this._icAction(b.dataset.ic, b);
    const k = b.dataset.k;
    if (k === 'gear') return this._setPopover(!this._popOpen);
    if (k === 'flabel') return;
    if (b.dataset.fin) return this.setFinish(b.dataset.fin);
    if (k === 'map') return this._setMapOpen(true);
    if (b.dataset.z) return this._zoomBy(+b.dataset.z > 0 ? 1 / 1.2 : 1.2);
    if (k === 'reserve') return this.opts.onReserve && this.opts.onReserve(this.unit && this.unit.id);
    if (k === 'ureserve') { const id = this._cardUnit ? this._cardUnit.id : this.unit && this.unit.id; this._hideUnitCard(); return this.opts.onReserve && this.opts.onReserve(id); }
    if (k === 'floors') { this._liftGridOpen = !this._liftGridOpen; return this._renderLiftPanel(); }
    if (k === 'carenter') return this._enterCar(this._chipRec);
    if (k === 'carexit') return this._exitCar();
    if (k === 'carview') return this._toggleCarView();
    if (k === 'carlights') return this._toggleHeadlights();
    if (k === 'carsound') return this._toggleCarSound();
    if (k === 'exit') { if (this.drive) this._engineStop(); return this.opts.onExit && this.opts.onExit(); }
    if (k === 'help') { this._setPopover(false); return this._showHelp(true); }
    if (k === 'photo') return this.takePhoto();
    if (k === 'helpok') return this._showHelp(false);
    if (k === 'dlabel') return this.el.tools.classList.toggle('col');
    if (b.dataset.vm) {
      if (b.dataset.vm !== 'real') return this._closePano();
      if (this._photoTourFn()) return this._tourHas() ? this._openPhotoTour() : this._soonTip();
      return this._openPano();
    }
    if (b.dataset.m) return this.setMode(b.dataset.m);
    if (b.dataset.t) return this.setTimeMode(b.dataset.t);
    if (b.dataset.s) { this.el.tools.classList.add('col'); return this.setStyle(b.dataset.s); }
    if (b.dataset.tp) return this._goto(b.dataset.tp);
    if (b.dataset.room != null) { const r = this.rooms[+b.dataset.room]; if (r) return this._goto({ room: r }); }
    if (b.dataset.f != null && b.parentElement === this.el.liftGrid) { const inf = this._carOf(this.player.pos); if (inf) this._pressKey(inf, +b.dataset.f); }   // _pressKey ignores stops this tower does not have
  }
}
