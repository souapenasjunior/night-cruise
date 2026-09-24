// The drivable cars: realistic glTF models (credits in CREDITS below and on the credits screen).
// glb: how to read each file — orientation, real length, which meshes are wheels / calipers / lamps.
const Q = Math.PI / 2;

export const JDM_SPECS = [
  {
    id: 'r32', short: 'R32', name: 'Skyline GT-R R32', brand: 'NISSAN', number: '32', cls: 'Grand tourer',
    desc: 'O Godzilla original. Tração integral e turbo duplo: gruda nas curvas e não para de puxar.',
    colors: { main: '#16171b', accent: '#c9ccd2' },
    stats: { top: 265, accel: 8.6, grip: 1.12, drift: 0.85, mass: 1430 },
    sound: { type: 'v6', turbo: true, pops: 0.5 },
    wheels: {},
    glb: { file: 'models/r32.json', paint: /^paint$/, rotY: 0, length: 4.55, wheel: /^(tyre|rims|brake)$/, caliper: /^brake_caliper$/, headMat: /^headlights\.001$/, tailMat: /^rear_lights2?$/ },
  },
  {
    id: 's13', short: 'S13', name: 'Silvia S13', brand: 'NISSAN', number: '13', cls: 'Drift',
    desc: 'Leve, tração traseira e turbo: a escola do drift. A traseira sai com um toque.',
    colors: { main: '#e8e8e4', accent: '#8e939b' },
    stats: { top: 240, accel: 7.4, grip: 0.95, drift: 1.4, mass: 1200 },
    sound: { type: 'i4turbo', turbo: true, pops: 0.8 },
    wheels: {},
    glb: { file: 'models/s13.json', paint: /^CarPaint2?$/, recolor: /^CarPaint$/, rotY: 0, length: 4.47, wheel: /^(Tyre|Rims|Rims\.001|RimsDark\.001|Lugs\.001|DOut|Dblack|DBlackIn)$/, caliper: /^Caliper$/, headMat: /^(HeadAlpha1|HeadIns2|HeadlightInside)$/, tailMat: /^(TailAlpha|Taillight)$/ },
  },
  {
    id: 's14', short: 'S14', name: 'Silvia S14', brand: 'NISSAN', number: '14', cls: 'Drift',
    desc: 'A Silvia dos anos 90: entre-eixos maior, mais estável que a S13 e ainda feita para deslizar.',
    colors: { main: '#eceff2', accent: '#2a2d33' },
    stats: { top: 250, accel: 7.8, grip: 0.98, drift: 1.35, mass: 1240 },
    sound: { type: 'i4turbo', turbo: true, pops: 0.7 },
    wheels: {},
    glb: { file: 'models/s14.json', paint: /^Material\.003$/, rotY: 0, length: 4.5, wheel: /^Material\.(021|022)$/, headPts: /^Material\.009$/, tailMat: /^Material\.01[01]$/ },
  },
  {
    id: 'z350', short: '350Z', name: '350Z', brand: 'NISSAN', number: '35', cls: 'Esportivo',
    desc: 'V6 aspirado com ronco encorpado. Equilibrado, previsível e rápido na saída de curva.',
    colors: { main: '#d98c14', accent: '#1a1a1a' },
    stats: { top: 255, accel: 7.9, grip: 1.0, drift: 1.2, mass: 1450 },
    sound: { type: 'v6', pops: 0.6 },
    wheels: {},
    glb: { file: 'models/z350.json', paint: /^black_paint$/, rotY: 0, length: 4.35, wheel: /^(rims|brakes|tire)$/, caliper: /^brake_caliper$/, headMat: /^(headlights|lights_front)$/, tailMat: /^rear_lights$/ },
  },
  {
    id: 'nsx', short: 'NSX', name: 'NSX', brand: 'HONDA', number: '90', cls: 'Superesportivo',
    desc: 'Motor central V6 que gira alto. Leve e afiado, o carro mais preciso da garagem.',
    colors: { main: '#f0f0ee', accent: '#141414' },
    stats: { top: 270, accel: 8.4, grip: 1.1, drift: 0.95, mass: 1370 },
    sound: { type: 'flat6', pops: 0.4 },
    wheels: {},
    glb: { file: 'models/nsx.json', rotY: 0, length: 4.4, wheel: /^Material\.(011|018|021|023)$/, headMat: /^Material\.013$/, tailMat: /^Material\.009$/, paint: /^Material\.003$/ },
  },
  {
    id: 'tiara83', short: "GT '83", name: "Tiara GT '83", brand: 'TIARA', number: '86', cls: 'Clássico',
    desc: 'Cupê leve dos anos 80, tração traseira e motor que grita. Lendário nas descidas de montanha.',
    colors: { main: '#efefef', accent: '#1b1b1b' },
    stats: { top: 215, accel: 6.9, grip: 0.92, drift: 1.5, mass: 950 },
    sound: { type: 'i4rally', pops: 0.9 },
    wheels: {},
    glb: { file: 'models/tiara83.json', paint: /Bodymat$/, rotY: -Q, length: 4.2, wheelNode: /WheelTuner/, caliperNode: /CaliperTuner/, headNode: /_Headlights_/, tailNode: /_Brakelights_/, revNode: /_Reverselights_/ },
  },
];

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
    glb: { file: 'models/t_wagon.json', rotY: 0, length: 4.55, tint: /^body/, wheelMat: /^(tire|rims)/, headY: 0.64, tailY: 0.77, lampX: 0.6 } },
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
  { title: '1992 Nissan Silvia S13', author: 'bagged_ls', url: 'https://sketchfab.com/3d-models/1992-nissan-silvia-s13-6fa8f1948f954e3b980b5e96f203815a' },
  { title: 'Nissan 200SX Silvia S14', author: 'Lexyc16', url: 'https://sketchfab.com/3d-models/nissan-200sx-silvia-s14-f2a917a924734a89a020e7f970e55e7c' },
  { title: 'Nissan 350Z', author: 'Blue3D', url: 'https://sketchfab.com/3d-models/nissan-350z-0b6b898a28364c389b0ac82e9b476f1a' },
  { title: 'Honda NSX 1990', author: 'Lexyc16', url: 'https://sketchfab.com/3d-models/honda-nsx-1990-1cc15628a00a4739a6b6c01128927c8d' },
  { title: "Tiara GT '83 Tuned - Low poly model", author: 'Daniel Zhabotinsky', url: 'https://sketchfab.com/3d-models/tiara-gt-83-tuned-low-poly-model-59a0eaaa2af144b2956957e7032d0221' },
  { title: 'low-poly Toyota Corolla E80 Sedan', author: 'D_U', url: 'https://sketchfab.com/3d-models/low-poly-toyota-corolla-e80-sedan-6254cf268d9b46f79dd2a6511e153891' },
  { title: 'Daihatsu Move Conte (Low Poly)', author: 'NNXST', url: 'https://sketchfab.com/3d-models/daihatsu-move-conte-low-poly-eff914331c194de0abe20a33d2c3a2c3' },
  { title: 'Low Poly Car: Toyota ToyoAce Van', author: 'ROH3D', url: 'https://sketchfab.com/3d-models/low-poly-car-toyota-toyoace-van-b8abd3caa4864f41aaba6a583591155d' },
  { title: 'Isuzu Erga Mio bus', author: 'own.guest', url: 'https://sketchfab.com/3d-models/isuzu-erga-mio-bus-050e8acd0bbc4da0902a8a874ef10fca' },
  { title: 'Lowpoly Sedan & Wagon', author: 'Han66st', url: 'https://sketchfab.com/3d-models/lowpoly-sedan-wagon-e11a46478c674b279fe9d299b2125c30' },
];
