// The drivable cars, which are also the traffic: two generic packs (passenger cars and civil service
// vehicles), prepared from their FBX files (ncmodels/gen: convert.html, build3.mjs) into models/<id>.json
// + WebP textures: facing +z, metres, tyres on y = 0, every wheel its own node (wheel_*), so they roll.
// Each keeps its own paint (textured): there is no colour choice. The card pictures of the car select are
// img/cars/<id>.webp. Names are the packs' own.
import { t } from './i18n.js';

const PASS = 'Generic Passenger Car Pack', CIVIL = 'Generic Civil Service Vehicles Pack';
// [id, name, class, pack, stripe colour, stats, sound, traffic: [weight, v min, v max, heavy]]
// stats: top km/h; accel = 33.9 / the 0-100 km/h time shown. Tuned for fun, not realism: every car is
// quick (the Sport still the quickest, the buses still the slowest);
// grip; drift (how loose the rear is); mass kg
const CARS = [
  ['g_compact', 'Compact', 'street', PASS, '#39c6d6', { top: 220, accel: 5.8, grip: 0.88, drift: 0.95, mass: 1000 }, { type: 'i4small', pops: 0 }, [12, 72, 100]],
  ['g_hatchback', 'Hatchback', 'street', PASS, '#e8d21c', { top: 235, accel: 6.2, grip: 0.9, drift: 1.0, mass: 1150 }, { type: 'i4sr', pops: 0.3 }, [12, 75, 108]],
  ['g_sedan', 'Sedan', 'street', PASS, '#b3a33a', { top: 250, accel: 6.5, grip: 0.9, drift: 0.95, mass: 1450 }, { type: 'v6', pops: 0.2 }, [14, 78, 110]],
  ['g_wagon', 'Wagon', 'street', PASS, '#4f9aa8', { top: 245, accel: 6.4, grip: 0.9, drift: 0.95, mass: 1550 }, { type: 'i4turbo', turbo: true, pops: 0.3 }, [10, 76, 106]],
  ['g_coupe', 'Coupe', 'sports', PASS, '#2446c8', { top: 290, accel: 8.9, grip: 0.96, drift: 1.35, mass: 1350 }, { type: 'v8muscle', pops: 0 }, [6, 80, 115]],
  ['g_sport', 'Sport', 'sports', PASS, '#d4262c', { top: 360, accel: 11.7, grip: 1.12, drift: 1.05, mass: 1300 }, { type: 'v10', pops: 0.9 }, [3, 85, 120]],
  ['g_minivan', 'Minivan', 'utility', PASS, '#8a1c24', { top: 225, accel: 5.6, grip: 0.82, drift: 0.8, mass: 1950 }, { type: 'v6', pops: 0.1 }, [10, 72, 100]],
  ['g_suv', 'SUV', 'utility', PASS, '#2a2c32', { top: 240, accel: 6.3, grip: 0.86, drift: 0.85, mass: 2500 }, { type: 'v8', pops: 0.4 }, [10, 76, 106]],
  ['g_offroad', 'Offroad', 'utility', PASS, '#3f5a2a', { top: 215, accel: 5.8, grip: 0.82, drift: 0.9, mass: 1900 }, { type: 'v6', pops: 0.3 }, [6, 70, 98]],
  ['g_pickup', 'Pickup', 'utility', PASS, '#1f7a3f', { top: 240, accel: 6.5, grip: 0.84, drift: 1.2, mass: 2400 }, { type: 'v8big', pops: 0.8 }, [8, 74, 104]],
  ['g_taxi', 'Taxi', 'service', CIVIL, '#f0b21c', { top: 250, accel: 6.8, grip: 0.9, drift: 1.0, mass: 1800 }, { type: 'v8mod', pops: 0 }, [8, 78, 110]],
  ['g_postvan', 'Post Van', 'service', CIVIL, '#1f3fa8', { top: 205, accel: 5.2, grip: 0.82, drift: 0.85, mass: 2500 }, { type: 'v6', pops: 0.1 }, [4, 70, 95]],
  ['g_servicetruck', 'Service Truck', 'service', CIVIL, '#d8d8d8', { top: 215, accel: 5.8, grip: 0.84, drift: 1.0, mass: 3000 }, { type: 'diesel8', turbo: true }, [3, 70, 98]],
  ['g_police', 'Police', 'emergency', CIVIL, '#141518', { top: 290, accel: 8.5, grip: 1.0, drift: 1.1, mass: 1800 }, { type: 'v8mod', pops: 0 }, [3, 80, 115]],
  ['g_ambulance', 'Ambulance', 'emergency', CIVIL, '#e83a2a', { top: 200, accel: 4.8, grip: 0.82, drift: 0.8, mass: 4500 }, { type: 'diesel8', turbo: true }, [2, 72, 98, true]],
  ['g_firetruck', 'Fire Truck', 'emergency', CIVIL, '#c81c1c', { top: 175, accel: 4.0, grip: 0.82, drift: 0.75, mass: 14000 }, { type: 'diesel6', turbo: true }, [1, 68, 88, true]],
  ['g_towtruck', 'Tow Truck', 'heavy', CIVIL, '#f0a01c', { top: 180, accel: 4.2, grip: 0.82, drift: 0.8, mass: 8000 }, { type: 'diesel4', turbo: true }, [2, 68, 90, true]],
  ['g_garbagetruck', 'Garbage Truck', 'heavy', CIVIL, '#1f5a3a', { top: 165, accel: 3.8, grip: 0.82, drift: 0.7, mass: 13000 }, { type: 'diesel6', turbo: true }, [2, 62, 82, true]],
  ['g_citybus', 'City Bus', 'heavy', CIVIL, '#e6e6e6', { top: 165, accel: 3.8, grip: 0.82, drift: 0.7, mass: 12000 }, { type: 'diesel6', turbo: true }, [3, 62, 82, true]],
  ['g_schoolbus', 'School Bus', 'heavy', CIVIL, '#f2c21c', { top: 170, accel: 3.9, grip: 0.82, drift: 0.7, mass: 11000 }, { type: 'diesel6', turbo: true }, [2, 62, 84, true]],
];
export const JDM_SPECS = CARS.map(([id, name, cls, brand, main, stats, sound]) => ({
  id, short: name, name, brand, number: '', cls, livery: true,
  colors: { main, accent: '#141414' }, stats, sound, wheels: {},
  glb: {
    file: `models/${id}.json`, rotY: 0, length: null, paint: /^Body$/, wheelNode: /^wheel_/, windowMat: /^Glass$/,
    // one lamp material (a lamp texture) for every lamp: head / tail told apart by position
    lampSplit: true, lampMat: /^Optics$/,
    // (the wheels were modelled straight: no axle correction)
    wheelsTrue: true,
    // traffic: the body tinted by `colors`, the lamp glows where the head / tail lamps are
    tint: /^Body$/,
  },
}));
// (the files are already in metres: the real length is the file's own)
for (const s of JDM_SPECS) s.glb.length = undefined;

// body colours (unused while every car keeps its own paint; the car select hides the choice)
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
// class (the card's tag) and description follow the language (texts in i18n.js: cls.*, car.<id>)
for (const s of JDM_SPECS) {
  const ck = 'cls.' + s.cls;
  s.clsKey = s.cls;
  Object.defineProperty(s, 'cls', { get: () => t(ck), enumerable: true });
  Object.defineProperty(s, 'desc', { get: () => t('car.' + s.id), enumerable: true });
}
PAINTS.forEach((p, i) => Object.defineProperty(p, 'name', { get: () => t('paint.' + i), enumerable: true }));

// Traffic: every car above, instanced. The passenger cars come in their own paint and three softer
// shades of it; the service vehicles keep their liveries.
export const TRAFFIC_GLB = CARS.map(([id, , , brand, , , , [weight, v0, v1, heavy]]) => {
  const spec = JDM_SPECS.find(s => s.id === id);
  return { id, weight, v: [v0, v1], heavy: !!heavy, shade: true, colors: brand === PASS ? ['orig', '#c9d2e6', '#e6cfc4', '#c6d6c2'] : ['orig'], glb: spec.glb };
});
// procedural traffic types still in use (none)
export const TRAFFIC_KEEP = [];
// attribution (shown on the credits screen)
export const CREDITS = [
  { title: 'Generic Passenger Car Pack', author: '', url: '' },
  { title: 'Generic Civil Service Vehicles Pack', author: '', url: '' },
];
