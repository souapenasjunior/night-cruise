// The drivable cars: realistic glTF models (credits in CREDITS below and on the credits screen).
// glb: how to read each file — orientation, real length, which meshes are wheels / calipers / lamps.
import { t } from './i18n.js';

const Q = Math.PI / 2;
// the premium cars' tailpipe tips (see `exhaust` below)
const EXHAUST = {
  p_eclipse: [[0.45, 0.3]], p_s2000: [[0.41, 0.29], [-0.4, 0.29]], p_s15: [[0.36, 0.27]], p_rx7: [[-0.5, 0.31]],
  p_supra: [[0.52, 0.3]], p_r34: [[0.4, 0.32]],
};

// Stats: real figures where the car exists (top speed; 0-100 km/h slightly quicker than the real one,
// accel = 37.7 / real 0-100 s; mass in kg), the film cars as tuned in the films; grip and "drift" (how
// loose the rear is) from the tyres, the drive (AWD holds on) and the car's character.
// Only the car marked `free` (the Tiara GT '83) is everyone's; every other one is bought with NCP
// (prices: cars.price_coins in the database), and the dearer the better: CAR_ORDER below.
// `premium`: the files live in the private Storage bucket, not in models/.
// (livery: every car keeps the paint of its file; there is no colour choice)
// exhaust: the tailpipe tips, [x, y] in metres (x from the centre line, + = the car's left; y from the
// ground), measured on rear renders of each model: where the backfire flames come out (flames.js)
const STOCK = [
  {
    id: 'tiara83', short: "GT '83", name: "Tiara GT '83", brand: 'TIARA', number: '86', cls: 'Clássico', livery: true, free: true,
    colors: { main: '#efefef', accent: '#1b1b1b' },
    stats: { top: 195, accel: 4.3, grip: 0.88, drift: 1.5, mass: 950 },
    sound: { type: 'i4rally', pops: 0.9 },
    wheels: {},
    glb: { file: 'models/tiara83.json', paint: /Bodymat$/, rotY: -Q, length: 4.2, wheelNode: /WheelTuner/, caliperNode: /CaliperTuner/, headNode: /_Headlights_/, tailNode: /_Brakelights_/, revNode: /_Reverselights_/, windowNode: /^TiaraGT83_(Glass|Trunkdoor_Glass|Windshield|Glass_Driver|Glass_Passenger)_UCB/, exhaust: [[0.36, 0.28]] },
  },
  {
    id: 'r32', short: 'R32', name: 'Skyline GT-R R32', brand: 'NISSAN', number: '32', cls: 'Grand tourer', livery: true,
    colors: { main: '#16171b', accent: '#c9ccd2' },
    stats: { top: 255, accel: 6.7, grip: 1.0, drift: 0.85, mass: 1430 },
    sound: { type: 'v6', turbo: true, pops: 0.5 },
    wheels: {},
    glb: { file: 'models/r32.json', paint: /^paint$/, rotY: 0, length: 4.55, wheel: /^(tyre|rims|brake)$/, caliper: /^brake_caliper$/, headMat: /^headlights\.001$/, tailMat: /^rear_lights2?$/, windowMat: /^widnows$/, exhaust: [[0.53, 0.3]] },
  },
  {
    id: 'nsx', short: 'NSX', name: 'NSX', brand: 'HONDA', number: '90', cls: 'Superesportivo', livery: true,
    colors: { main: '#f0f0ee', accent: '#141414' },
    stats: { top: 270, accel: 6.4, grip: 1.0, drift: 0.95, mass: 1370 },
    sound: { type: 'flat6', pops: 0.4 },
    wheels: {},
    glb: { file: 'models/nsx.json', rotY: 0, length: 4.4, wheel: /^Material\.(011|018|021|023)$/, headMat: /^Material\.013$/, tailMat: /^Material\.009$/, paint: /^Material\.003$/, windowMat: /^Material\.004$/, exhaust: [[0.51, 0.37], [-0.5, 0.37]] },
  },
];
// Premium cars: their files load only when picked on the car select, never with the game. Each keeps
// its original livery (painted in the texture), so there is no colour choice. The files were prepared
// (scale, wheels per corner, simplified, WebP: ncmodels/build.mjs, build2.mjs) so every wheel/caliper
// corner is its own mesh: wheel_* / caliper_* nodes. g: extra glb options (paint material, lamps...).
const PREMIUM = [
  // [id, short, name, brand, number, class, stripe colour, accent, length, stats, sound, g]
  ['p_mustang', 'GT350', 'Shelby GT350 1965', 'FORD', '65', 'Muscle', '#f2f2ee', '#1f4fa8', 4.61, { top: 215, accel: 5.8, grip: 0.86, drift: 1.4, mass: 1270 }, { type: 'v8big', pops: 1.0 }, { paint: /ChassisPaint/, lampMat: /ChassisBody0CLight/ }],
  ['p_eclipse', 'ECLIPSE', 'Eclipse 1995', 'MITSUBISHI', '95', 'Esportivo', '#27a55b', '#141414', 4.4, { top: 230, accel: 5.9, grip: 0.95, drift: 1.0, mass: 1400 }, { type: 'i4turbo', turbo: true, pops: 0.8 }],
  ['p_s2000', 'S2000', "Suki's S2000", 'HONDA', '20', 'Esportivo', '#e86aa6', '#f4f4f4', 4.13, { top: 240, accel: 6.1, grip: 1.02, drift: 1.05, mass: 1260 }, { type: 'i4vtec', pops: 0.4 }],
  ['p_s15', 'S15', 'Silvia S15 "Mona Lisa"', 'NISSAN', '15', 'Drift', '#e8761c', '#141414', 4.45, { top: 250, accel: 6.8, grip: 1.0, drift: 1.45, mass: 1250 }, { type: 'i4sr', turbo: true, pops: 1.0 }],
  ['p_rx7', 'RX-7', "Julius's RX-7", 'MAZDA', '7', 'Esportivo', '#d4262c', '#141414', 4.3, { top: 255, accel: 7.1, grip: 1.04, drift: 1.3, mass: 1280 }, { type: 'rotary', turbo: true, pops: 1.6 }, { headMaxY: 0.45 }], // (its pop-up headlamps stay down: the bumper fog lamps are the lights)
  ['p_evo7', 'EVO VII', "Brian's Evo VII", 'MITSUBISHI', '7', 'Esportivo', '#b6d43a', '#141414', 4.46, { top: 245, accel: 7.5, grip: 1.06, drift: 0.8, mass: 1400 }, { type: 'i4turbo', turbo: true, pops: 1.1 }, { paint: /Paint_Material/ }],
  ['p_supra', 'SUPRA', 'Supra MK IV', 'TOYOTA', '80', 'Superesportivo', '#f07818', '#141414', 4.51, { top: 285, accel: 8.2, grip: 1.06, drift: 1.15, mass: 1510 }, { type: 'i6jz', turbo: true, pops: 0.8 }],
  ['p_r34', 'R34', "Brian's Skyline R34", 'NISSAN', '34', 'Grand tourer', '#9db7d6', '#1b5fa8', 4.6, { top: 290, accel: 8.0, grip: 1.1, drift: 0.9, mass: 1560 }, { type: 'v6', turbo: true, pops: 0.6 }, { paintMetal: 0.6, paintRough: 0.35 }], // (the R32's engine voice: same RB26 family; the R34's metallic platinum silver)
  ['p_718', '718', '718 Spyder', 'PORSCHE', '18', 'Esportivo', '#eceef0', '#141414', 4.43, { top: 301, accel: 8.6, grip: 1.14, drift: 1.0, mass: 1420 }, { type: 'flat6', pops: 0.5 }, { paint: /^Carpaint_Max$/ }],
  ['p_challenger', 'CHALLENGER', 'Challenger SRT Super Stock', 'DODGE', '20', 'Muscle', '#e0461c', '#141414', 5.03, { top: 270, accel: 11.1, grip: 0.92, drift: 1.45, mass: 2015 }, { type: 'v8big', blower: true, pops: 1.2 }, { paint: /Paint_Material/, lampMat: /LightB/ }],
  ['p_vette13', 'Z06 C6', 'Corvette Z06 2013', 'CHEVROLET', '13', 'Superesportivo', '#e8c21c', '#141414', 4.46, { top: 318, accel: 9.9, grip: 1.1, drift: 1.2, mass: 1420 }, { type: 'v8', pops: 0.9 }, { paint: /^CM_CarPaint/, lampMat: /CM_Light_Max/ }],
  ['p_targa', 'TARGA', '911 Targa 4 GTS', 'PORSCHE', '25', 'Superesportivo', '#dfe6ea', '#141414', 4.54, { top: 312, accel: 12.6, grip: 1.15, drift: 0.85, mass: 1755 }, { type: 'flat6', turbo: true, pops: 0.6 }, { paint: /Paint_Material/ }],
  ['p_gtr35', 'GT-R', 'GT-R Black Edition', 'NISSAN', '35', 'Superesportivo', '#3a3d44', '#d4262c', 4.67, { top: 315, accel: 13.0, grip: 1.16, drift: 0.75, mass: 1740 }, { type: 'v6', turbo: true, pops: 0.7 }, { paint: /^CarPaint$/, lampMat: /^(phong5|light_glass)$/ }],
  ['p_458', '458', '458 Italia', 'FERRARI', '58', 'Superesportivo', '#d4262c', '#141414', 4.53, { top: 325, accel: 11.1, grip: 1.17, drift: 1.1, mass: 1485 }, { type: 'v8', pops: 0.7 }, { paint: /^carpaint$/, lampMat: /^(tail_light|detail_glass_clear)$/ }],
  ['p_r8', 'R8', 'R8 Green Hell', 'AUDI', '8', 'Superesportivo', '#2e9f6a', '#141414', 4.43, { top: 331, accel: 12.2, grip: 1.18, drift: 0.85, mass: 1595 }, { type: 'v10', pops: 0.9 }, { paint: /Paint_Material/ }],
  ['p_huracan', 'HURACÁN', 'Huracán Performante', 'LAMBORGHINI', '64', 'Superesportivo', '#6ab81e', '#141414', 4.51, { top: 325, accel: 13.0, grip: 1.24, drift: 0.9, mass: 1382 }, { type: 'v10', pops: 1.1 }, { paint: /^M_CarPaint_Max/, lampMat: /M_Light_Max|M_LightBucket/ }],
  ['p_vette23', 'Z06', 'Corvette Z06 2023', 'CHEVROLET', '23', 'Superesportivo', '#2446c8', '#141414', 4.69, { top: 312, accel: 14.5, grip: 1.2, drift: 1.05, mass: 1561 }, { type: 'v8', pops: 0.9 }, { paint: /Paint_Material/ }],
  ['p_911', '911 TS', '911 Turbo S', 'PORSCHE', '92', 'Superesportivo', '#a39e8a', '#141414', 4.54, { top: 330, accel: 14.0, grip: 1.2, drift: 0.85, mass: 1640 }, { type: 'flat6', turbo: true, pops: 0.6 }, { paint: /^body_main$/, lampMat: /^(lights|red_light_main|headlights_pattern)$/ }],
].map(([id, short, name, brand, number, cls, main, accent, length, stats, sound, g]) => ({
  id, short, name, brand, number, cls, premium: 'premium_pack', livery: true,
  colors: { main, accent }, stats, sound, wheels: {},
  glb: {
    file: `models/${id}.json`, rotY: 0, length, paint: /Paint/,
    wheelNode: /^wheel_/, caliperNode: /^caliper_/,
    // one lamp material covers every lamp (and parts under the car): lamps are told apart by position
    // (only the textured reflectors light up; the lenses in front of them are tinted glass)
    lampSplit: true, lampMat: /LightA/,
    exhaust: EXHAUST[id],
    ...(g || {}),
  },
}));
// the car select, weakest (free) to strongest (dearest): the same order as the prices
export const CAR_ORDER = ['tiara83', 'p_mustang', 'p_eclipse', 'p_s2000', 'p_s15', 'r32', 'nsx', 'p_rx7', 'p_evo7', 'p_supra', 'p_r34',
  'p_718', 'p_challenger', 'p_vette13', 'p_targa', 'p_gtr35', 'p_458', 'p_r8', 'p_huracan', 'p_vette23', 'p_911'];
export const JDM_SPECS = CAR_ORDER.map(id => [...STOCK, ...PREMIUM].find(s => s.id === id));

// body colours offered for every car (the first one is the default)
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

// Ordinary traffic drawn from glTF models (instanced). v = cruise speed range (km/h); tint = the
// material recoloured per car from `colors` (the others keep their own colours / textures).
export const TRAFFIC_GLB = [
  // colours: 'orig' = the model's own paint, then three darker ones. The E80 body is a flat colour,
  // so its extra colours replace it; on the textured models (shade: true) they darken the texture.
  { id: 't_e80', weight: 30, v: [80, 112], colors: ['orig', '#1f2a44', '#4a1a1e', '#26352b'],
    glb: { file: 'models/t_e80.json', rotY: Q, length: 4.15, tint: /^gray$/, headY: 0.62, tailY: 0.7 } },
  { id: 't_conte', weight: 26, v: [72, 98], shade: true, colors: ['orig', '#6f82a8', '#9a5f5a', '#72876c'],
    glb: { file: 'models/t_conte.json', rotY: 0, length: 3.4, tint: /./, headY: 0.78, tailY: 0.95 } },
  { id: 't_van', weight: 26, v: [78, 105], shade: true, colors: ['orig', '#6f82a8', '#9a5f5a', '#72876c'],
    glb: { file: 'models/t_van.json', rotY: Math.PI, length: 4.7, tint: /^Body$/, headY: 0.78, tailY: 0.9 } },
  // Lowpoly Sedan & Wagon (one Sketchfab scene, split into two models); flat-colour bodies like the E80
  { id: 't_sedan', weight: 26, v: [80, 110], colors: ['orig', '#1d2740', '#27342a', '#2b2c31'],
    glb: { file: 'models/t_sedan.json', rotY: 0, length: 4.5, tint: /^body/, wheelMat: /^(tire|rims)/, headY: 0.64, tailY: 0.74, lampX: 0.6 } },
  { id: 't_wagon', weight: 22, v: [78, 106], colors: ['orig', '#243049', '#2e3a2c', '#3a3634'],
    // (the wagon was modelled turned ~7° in its file: rotY straightens it, or it crabs and its wheels wobble)
    glb: { file: 'models/t_wagon.json', rotY: 0.1215, length: 4.55, tint: /^body/, wheelMat: /^(tire|rims)/, headY: 0.64, tailY: 0.77, lampX: 0.6 } },
  // the bus keeps its livery: three darker tones of it rather than other hues
  // (low weight: the variety rule favours whatever is rare nearby, and a slow bus queues traffic)
  { id: 't_bus', weight: 3, v: [70, 85], heavy: true, shade: true, colors: ['orig', '#c2c6ce', '#a3abbb', '#b4aa9c'],
    glb: { file: 'models/t_bus.json', rotY: -Q, length: 10.5, tint: /./, headY: 0.9, tailY: 1.1, lampX: 0.95 } },
];
// procedural traffic types still in use (none: all traffic is modelled now)
export const TRAFFIC_KEEP = [];
// CC-BY 4.0 attribution (shown on the credits screen)
export const CREDITS = [
  { title: 'Nissan Skyline R32 GTR', author: 'Blue3D', url: 'https://sketchfab.com/3d-models/nissan-skyline-r32-gtr-e2a16f567a7e4d0ab99c0bd6460ba396' },
  { title: 'Honda NSX 1990', author: 'Lexyc16', url: 'https://sketchfab.com/3d-models/honda-nsx-1990-1cc15628a00a4739a6b6c01128927c8d' },
  { title: "Tiara GT '83 Tuned - Low poly model", author: 'Daniel Zhabotinsky', url: 'https://sketchfab.com/3d-models/tiara-gt-83-tuned-low-poly-model-59a0eaaa2af144b2956957e7032d0221' },
  { title: 'low-poly Toyota Corolla E80 Sedan', author: 'D_U', url: 'https://sketchfab.com/3d-models/low-poly-toyota-corolla-e80-sedan-6254cf268d9b46f79dd2a6511e153891' },
  { title: 'Daihatsu Move Conte (Low Poly)', author: 'NNXST', url: 'https://sketchfab.com/3d-models/daihatsu-move-conte-low-poly-eff914331c194de0abe20a33d2c3a2c3' },
  { title: 'Low Poly Car: Toyota ToyoAce Van', author: 'ROH3D', url: 'https://sketchfab.com/3d-models/low-poly-car-toyota-toyoace-van-b8abd3caa4864f41aaba6a583591155d' },
  { title: 'Isuzu Erga Mio bus', author: 'own.guest', url: 'https://sketchfab.com/3d-models/isuzu-erga-mio-bus-050e8acd0bbc4da0902a8a874ef10fca' },
  { title: 'Lowpoly Sedan & Wagon', author: 'Han66st', url: 'https://sketchfab.com/3d-models/lowpoly-sedan-wagon-e11a46478c674b279fe9d299b2125c30' },
  // premium pack
  { title: "Brian's R34 from 2 Fast 2 Furious", author: 'DRIVER-FIRE', url: 'https://sketchfab.com/3d-models/brians-r34-from-2-fast-2-furious-c424e4f18c9742d296920f069d139b45' },
  { title: "Julius's RX7 from 2Fast 2Furious", author: 'DRIVER-FIRE', url: 'https://sketchfab.com/3d-models/juliuss-rx7-from-2fast-2furious-df6988a4756c48f5a038327ae750058f' },
  { title: 'Mitsubishi Eclipse From F&F', author: 'DRIVER-FIRE', url: 'https://sketchfab.com/3d-models/mitsubishi-eclipse-from-ff-72f24781cf0e4672a39c2603352eebcb' },
  { title: 'Nissan S15 "Mona Lisa" From F&F Tokyo Drift', author: 'DRIVER-FIRE', url: 'https://sketchfab.com/3d-models/nissan-s15-mona-lisa-from-ff-tokyo-drift-a258e6e9a0974aa693ea3e55d0931a6e' },
  { title: "Suki's S2000 from 2Fast 2Furious", author: 'DRIVER-FIRE', url: 'https://sketchfab.com/3d-models/sukis-s2000-from-2fast-2furious-c1469160e8b1448db5b8b760ffd1d33f' },
  { title: 'Toyota Supra from F&F', author: 'DRIVER-FIRE', url: 'https://sketchfab.com/3d-models/toyota-supra-from-ff-460aa5fc92904f36a81bcdf4fc5e166f' },
  // second batch (CC-BY 4.0)
  { title: '1965 Ford Mustang Shelby GT350', author: '007', url: 'https://sketchfab.com/3d-models/1965-ford-mustang-shelby-gt350-c65ba31b892a404890625dffc01a0843' },
  { title: '2002 Mitsubishi Lancer Evolution VII', author: '007', url: 'https://sketchfab.com/3d-models/2002-mitsubishi-lancer-evolution-vii-85d8a00e14a044de9712586fa71a5523' },
  { title: '2020 Porsche 718 Spyder', author: '007', url: 'https://sketchfab.com/3d-models/2020-porsche-718-spyder-433c9de37b8a46e18fccfa1c90b5ac27' },
  { title: '2020 Dodge Challenger SRT Super Stock', author: '007', url: 'https://sketchfab.com/3d-models/2020-dodge-challenger-srt-super-stock-f8c1bdc6b1c14743b59b9c229efecbbb' },
  { title: '2013 Chevrolet Corvette Z06', author: '007', url: 'https://sketchfab.com/3d-models/2013-chevrolet-corvette-z06-60d912ca08b54734b38da70b4dedbf59' },
  { title: '2025 Porsche 911 Targa 4 GTS', author: '007', url: 'https://sketchfab.com/3d-models/2025-porsche-911-targa-4-gts-214a61d759e942e2887290b6e4e50d49' },
  { title: '2013 Nissan GT-R Black Edition Coupe', author: '007', url: 'https://sketchfab.com/3d-models/2013-nissan-gt-r-black-edition-coupe-23b5ac6f97f74a9f90074e7bf6463062' },
  { title: '2011 Ferrari 458 Italia', author: '007', url: 'https://sketchfab.com/3d-models/2011-ferrari-458-italia-6a9572dc08204545b0b36dba44a4c41f' },
  { title: '2021 Audi R8 Green Hell Edition', author: '007', url: 'https://sketchfab.com/3d-models/2021-audi-r8-green-hell-edition-ecec0f448de34da7aa59cf71a2ea94b3' },
  { title: '2018 Lamborghini Huracán Performante', author: '007', url: 'https://sketchfab.com/3d-models/2018-lamborghini-huracan-performante-e1cbf8d949274576930d97ff65302750' },
  { title: '2023 Chevrolet Corvette Z06', author: '007', url: 'https://sketchfab.com/3d-models/2023-chevrolet-corvette-z06-1f26320a96d34cb7a8fa802c7e477e48' },
  { title: 'Porsche 911 with interior', author: 'n.brizitskaya', url: 'https://sketchfab.com/3d-models/porsche-911-with-interior-877b1bc1739f4a2bb65d62fd7ffd9f75' },
];
