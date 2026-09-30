// The drivable cars and the traffic: realistic glTF models in models/ (credits in CREDITS below and on
// the credits screen). There are none at the moment: new cars will be added here.
//
// A drivable car looks like this (glb: how to read its file — orientation, real length, which meshes are
// wheels / calipers / lamps; see glbcars.js):
//   { id: 'r32', short: 'R32', name: 'Skyline GT-R R32', brand: 'NISSAN', number: '32', cls: 'Grand tourer',
//     livery: true, colors: { main: '#16171b', accent: '#c9ccd2' },
//     stats: { top: 255, accel: 6.7, grip: 1.0, drift: 0.85, mass: 1430 },   // accel = 37.7 / real 0-100 s
//     sound: { type: 'v6', turbo: true, pops: 0.5 }, wheels: {},
//     glb: { file: 'models/r32.json', rotY: 0, length: 4.55, paint: /^paint$/, wheel: /^(tyre|rims)$/,
//            headMat: /^headlights$/, tailMat: /^rear_lights$/, exhaust: [[0.53, 0.3]] } }
// (its class and description texts: cls.* and car.<id> in i18n.js)
import { t } from './i18n.js';

export const JDM_SPECS = [];

// body colours offered for every car without a livery (the first one is the default)
export const PAINTS = [
  { name: 'Branco', hex: '#eceef0' },
  { name: 'Preto', hex: '#141518' },
  { name: 'Azul', hex: '#1f4fa8' },
  { name: 'Vermelho', hex: '#b0182a' },
  { name: 'Verde', hex: '#1f7a3f' },
  { name: 'Amarelo', hex: '#e8c21c' },
  { name: 'Rosa', hex: '#e86aa6' },
];
for (const s of JDM_SPECS) s.paints = PAINTS.map(p => p.hex);
// class and description follow the language (texts in i18n.js: cls.*, car.<id>)
const CLS_KEY = { 'Grand tourer': 'cls.gt', Drift: 'cls.drift', Esportivo: 'cls.sports', Superesportivo: 'cls.super', 'Clássico': 'cls.classic', Muscle: 'cls.muscle' };
for (const s of JDM_SPECS) {
  const ck = CLS_KEY[s.cls];
  Object.defineProperty(s, 'cls', { get: () => t(ck), enumerable: true });
  Object.defineProperty(s, 'desc', { get: () => t('car.' + s.id), enumerable: true });
}
PAINTS.forEach((p, i) => Object.defineProperty(p, 'name', { get: () => t('paint.' + i), enumerable: true }));

// Ordinary traffic drawn from glTF models (instanced). None at the moment: the roads are empty.
// An entry: { id, weight, v: [min, max] km/h, colors: ['orig', '#1f2a44', ...], shade?, heavy?,
//             glb: { file, rotY, length, tint: /material/, headY, tailY } }
export const TRAFFIC_GLB = [];
// procedural traffic types still in use (none)
export const TRAFFIC_KEEP = [];
// CC-BY 4.0 attribution (shown on the credits screen)
export const CREDITS = [];
